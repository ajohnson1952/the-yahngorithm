// ============================================================
// Market flags: reverse line movement (RLM) and steam
// ============================================================
// Separate from the situational flags (computeFlags.ts) because these
// come from line + prediction-market data, not the schedule.
//
//  steam  — the consensus spread made a fast, synchronized move
//           (>= STEAM_PTS between two snapshots taken within STEAM_WINDOW
//           hours, most books moving together). Fires on the team the
//           line moved TOWARD. Needs frequent line snapshots to detect;
//           dormant until pull-lines runs more than once a day.
//
//  rlm    — the book's number moved one way while the Kalshi prediction
//           market (real money, no vig) moved the other way, on a market
//           with real volume. Fires on the team the BOOK moved toward —
//           the side the public is on that the sharp market doesn't back.
//           That's the fade side.
//
// Wipe + rewrite the 'steam' / 'rlm' rows for the target week.
//
// Run:  npm run compute-market-flags [-- --season 2026 --week 3]
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { median } from "../lib/consensus";
import { spreadToProb } from "../lib/winProb";

const prisma = new PrismaClient();

const STEAM_PTS = 1.5; // consensus move that counts as steam
const STEAM_WINDOW_H = 8; // ...within this many hours
const STEAM_MIN_BOOKS = 3;

const RLM_MIN_VOLUME = 500; // Kalshi contracts on the event
const RLM_BOOK_MOVE = 0.03; // book implied-prob move to count
const RLM_KALSHI_TOL = 0.01; // Kalshi "didn't follow" band

function parseArgs() {
  const a = process.argv.slice(2);
  const v = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 && a[i + 1] ? Number(a[i + 1]) : undefined;
  };
  return { season: v("--season"), week: v("--week") };
}

interface Snap {
  at: Date;
  type: string;
  spread: number | null; // consensus home spread (neg = home favored)
  books: number;
}

/** bucket a game's spread lines into snapshot runs, oldest first */
function snapshots(
  lines: { lineValue: number; sportsbook: string; snapshotType: string; capturedAt: Date; market: string }[]
): Snap[] {
  const spreads = lines
    .filter((l) => l.market === "spread")
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const buckets: (typeof spreads)[] = [];
  for (const l of spreads) {
    const last = buckets[buckets.length - 1];
    if (
      last &&
      l.capturedAt.getTime() - last[0].capturedAt.getTime() <= 90 * 60 * 1000
    ) {
      last.push(l);
    } else buckets.push([l]);
  }
  return buckets.map((b) => ({
    at: b[0].capturedAt,
    type: b[0].snapshotType,
    spread: median(b.map((x) => x.lineValue)),
    books: new Set(b.map((x) => x.sportsbook)).size,
  }));
}

async function main() {
  const args = parseArgs();
  const auto = await getCurrentSeasonWeek();
  const season = args.season ?? auto.season;
  const week = args.week ?? auto.week;

  console.log(`Market flags — season ${season}, week ${week}\n`);

  const games = await prisma.game.findMany({
    where: { season, week },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { canonicalName: true } },
      awayTeam: { select: { canonicalName: true } },
      lines: {
        select: {
          lineValue: true,
          sportsbook: true,
          snapshotType: true,
          capturedAt: true,
          market: true,
        },
      },
      predictionMarkets: { orderBy: { capturedAt: "asc" } },
    },
  });

  const rows: Prisma.GameFlagCreateManyInput[] = [];
  let steam = 0;
  let rlm = 0;

  for (const g of games) {
    const snaps = snapshots(g.lines);

    // ---- steam ----
    for (let i = 1; i < snaps.length; i++) {
      const a = snaps[i - 1];
      const b = snaps[i];
      if (a.spread == null || b.spread == null) continue;
      const hrs = (b.at.getTime() - a.at.getTime()) / 3_600_000;
      if (hrs > STEAM_WINDOW_H) continue;
      const move = b.spread - a.spread; // + = line moved toward away team
      if (Math.abs(move) < STEAM_PTS) continue;
      if (Math.min(a.books, b.books) < STEAM_MIN_BOOKS) continue;
      // line moved toward: negative move (home spread more negative) => toward home
      const towardTeamId = move < 0 ? g.homeTeamId : g.awayTeamId;
      rows.push({
        gameId: g.id,
        teamId: towardTeamId,
        flagType: "steam",
        detail: {
          movePts: Math.round(Math.abs(move) * 10) / 10,
          hours: Math.round(hrs * 10) / 10,
          books: Math.min(a.books, b.books),
        },
      });
      steam++;
      break; // one steam flag per game
    }

    // ---- rlm ----
    const openSpread =
      snaps.find((s) => s.type === "open")?.spread ?? snaps[0]?.spread ?? null;
    const nowSpread = snaps[snaps.length - 1]?.spread ?? null;
    const pm = g.predictionMarkets;
    const pmNow = pm[pm.length - 1];
    if (openSpread != null && nowSpread != null && pmNow) {
      const bookHomeProbOpen = spreadToProb(-openSpread);
      const bookHomeProbNow = spreadToProb(-nowSpread);
      const bookMove = bookHomeProbNow - bookHomeProbOpen; // + = book moved toward home
      const kalshiPrev =
        pm[0].homePrevProb ?? pm[0].homeWinProb; // oldest signal we have
      const kalshiMove = pmNow.homeWinProb - kalshiPrev;

      const bookMoved = Math.abs(bookMove) >= RLM_BOOK_MOVE;
      const kalshiDidNotFollow =
        Math.sign(bookMove) !== Math.sign(kalshiMove) ||
        Math.abs(kalshiMove) < RLM_KALSHI_TOL;
      const enoughVolume = pmNow.volume >= RLM_MIN_VOLUME;

      if (bookMoved && kalshiDidNotFollow && enoughVolume) {
        const towardTeamId = bookMove > 0 ? g.homeTeamId : g.awayTeamId;
        rows.push({
          gameId: g.id,
          teamId: towardTeamId,
          flagType: "rlm",
          detail: {
            bookMovePts:
              Math.round((nowSpread - openSpread) * -10) / 10, // home-margin pts
            kalshiProb: Math.round(pmNow.homeWinProb * 100) / 100,
            kalshiMove: Math.round(kalshiMove * 100) / 100,
            volume: Math.round(pmNow.volume),
          },
        });
        rlm++;
      }
    }
  }

  const del = await prisma.gameFlag.deleteMany({
    where: { flagType: { in: ["steam", "rlm"] }, game: { season, week } },
  });
  if (rows.length) await prisma.gameFlag.createMany({ data: rows });

  console.log("============================================================");
  console.log(`Removed ${del.count} old market flags.`);
  console.log(`steam: ${steam}    rlm: ${rlm}`);
  console.log(
    steam === 0
      ? "  (no steam — expected until pull-lines runs more than once a day)"
      : ""
  );
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
