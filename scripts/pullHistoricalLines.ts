// ============================================================
// Historical betting lines backfill (CFBD /lines)
// ============================================================
// The Odds API only serves current weeks. CFBD /lines carries the
// opening + closing number per provider (DraftKings, ESPN Bet, Bovada)
// going back years — enough for ATS records, real CLV on past picks,
// and a model backtest.
//
// Writes into the same Line table with source='cfbd', so consensus /
// grading / the board all work unchanged. Two rows per provider per
// market: snapshotType 'open' (from spreadOpen/overUnderOpen) and
// 'close' (from spread/overUnder). capturedAt = kickoff.
//
// Only touches FINAL games, and skips any game that already has a live
// ('odds_api') line — so it never collides with the live pipeline.
// Idempotent: wipes this season's source='cfbd' rows first.
//
// Run:  npm run pull-historical-lines -- --season 2024
//       npm run pull-historical-lines -- --season 2025 --week 6
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { cfbdGet } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface CfbdLineGame {
  season: number;
  week: number;
  seasonType: string;
  homeTeam: string;
  awayTeam: string;
  lines:
    | {
        provider: string;
        spread: number | null;
        spreadOpen: number | null;
        overUnder: number | null;
        overUnderOpen: number | null;
      }[]
    | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const season = val("--season");
  if (!season) {
    console.error("Pass --season (e.g. --season 2024). Stopping.");
    process.exit(1);
  }
  const week = val("--week");
  return { season: Number(season), week: week ? Number(week) : undefined };
}

async function main() {
  const { season, week: weekArg } = parseArgs();
  const teams = await buildTeamResolver(prisma, "cfbd");

  const games = await prisma.game.findMany({
    where: { season, status: "final", ...(weekArg ? { week: weekArg } : {}) },
    select: {
      id: true,
      week: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffTime: true,
      lines: { select: { source: true }, where: { source: "odds_api" }, take: 1 },
    },
  });
  const gameByPair = new Map<string, (typeof games)[number]>();
  for (const g of games) gameByPair.set(`${g.homeTeamId}|${g.awayTeamId}`, g);

  const weeks = weekArg
    ? [weekArg]
    : [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);

  console.log(
    `Historical lines — season ${season}, ${games.length} final games, ` +
      `weeks ${weeks.join(", ")}\n`
  );

  // idempotent: clear this season's CFBD rows first
  const cleared = await prisma.line.deleteMany({
    where: { source: "cfbd", game: { season, ...(weekArg ? { week: weekArg } : {}) } },
  });
  if (cleared.count) console.log(`Cleared ${cleared.count} prior cfbd rows.\n`);

  const rows: Prisma.LineCreateManyInput[] = [];
  let matched = 0;
  let skippedLive = 0;
  const unresolved = new Set<string>();

  for (const week of weeks) {
    const data = await cfbdGet<CfbdLineGame[]>(
      `/lines?year=${season}&week=${week}&seasonType=regular`
    ).catch(() => [] as CfbdLineGame[]);

    for (const lg of data) {
      const homeId = teams.resolve(lg.homeTeam);
      const awayId = teams.resolve(lg.awayTeam);
      if (!homeId || !awayId) {
        if (!homeId) unresolved.add(lg.homeTeam);
        if (!awayId) unresolved.add(lg.awayTeam);
        continue;
      }
      const g = gameByPair.get(`${homeId}|${awayId}`);
      if (!g || g.week !== week) continue;
      if (g.lines.length > 0) {
        skippedLive++;
        continue;
      }

      for (const ln of lg.lines ?? []) {
        const push = (
          market: string,
          snapshotType: string,
          value: number | null
        ) => {
          if (value == null) return;
          rows.push({
            gameId: g.id,
            sportsbook: ln.provider,
            market,
            lineValue: value,
            snapshotType,
            source: "cfbd",
            capturedAt: g.kickoffTime,
          });
        };
        push("spread", "close", ln.spread);
        push("spread", "open", ln.spreadOpen);
        push("total", "close", ln.overUnder);
        push("total", "open", ln.overUnderOpen);
      }
      matched++;
    }
  }

  if (rows.length) {
    for (let i = 0; i < rows.length; i += 1000) {
      await prisma.line.createMany({ data: rows.slice(i, i + 1000) });
    }
  }

  console.log("============================================================");
  console.log(`Games matched:       ${matched}`);
  console.log(`Line rows written:   ${rows.length}`);
  console.log(`Skipped (live line): ${skippedLive}`);
  if (unresolved.size) {
    console.log(
      `Unresolved teams (${unresolved.size}): ${[...unresolved].slice(0, 20).join(", ")}` +
        (unresolved.size > 20 ? " …" : "")
    );
  }
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
