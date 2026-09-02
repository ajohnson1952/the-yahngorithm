// ============================================================
// Pick generation  (PROJECT_BRIEF: the actual output)
// ============================================================
// A model edge is only logged as a Pick when it clears the edge
// threshold AND a second independent signal agrees AND it survives
// the "don't bet blowouts" filters. Everything else is a lean, not
// a pick.
//
//   SPREAD  |edge| >= 2.5, market spread within 20, and either
//           - SRS agrees (same side, also >= 2.5), or
//           - a situational flag points the same way
//   TOTAL   |edge| >= 3.5, game competitive (spread within 14), and
//           - UNDER: strong wind, or a slow projected pace
//           - OVER:  a fast projected pace
//
// Picks are logged once (first time they qualify) and never rewritten
// — the model line / market line / edge are captured as of that
// moment, for honest grading later. No API calls.
//
// Run:  npm run generate-picks
//       npm run generate-picks -- --season 2026 --week 3
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import {
  SPREAD_EDGE_THRESHOLD,
  TOTAL_EDGE_THRESHOLD,
  LARGE_SPREAD_CAP,
  TOTALS_COMPETITIVE_CAP,
  SLOW_GAME_POSSESSIONS,
  FAST_GAME_POSSESSIONS,
  WIND_UNDER_CORROBORATION,
} from "../lib/modelConfig";
import { consensusByGame } from "../lib/consensus";

const prisma = new PrismaClient();

// Flags that count as the 2nd independent signal for a pick. Trimmed to
// the ones the 2021-25 backtest respects (docs/CALIBRATION.md): short_week
// corroboration graded ~39% ATS and off_bye ~50%, so both were dropped —
// they still display on the board, they just don't corroborate a pick.
const FLAG_HURTS = new Set(["travel", "lookahead", "letdown"]);
const FLAG_HELPS = new Set(["revenge"]);

function parseArgs(): { season?: number; week?: number } {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const season = val("--season");
  const week = val("--week");
  if ((season && !week) || (!season && week)) {
    console.error("Pass --season AND --week together, or neither. Stopping.");
    process.exit(1);
  }
  return {
    season: season ? Number(season) : undefined,
    week: week ? Number(week) : undefined,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

async function main() {
  const o = parseArgs();
  const { season, week } =
    o.season != null && o.week != null
      ? { season: o.season, week: o.week }
      : await getCurrentSeasonWeek();

  console.log(`Pick generation — season ${season}, week ${week}\n`);

  const games = await prisma.game.findMany({
    where: {
      season,
      week,
      homeTeam: { classification: "fbs" },
      awayTeam: { classification: "fbs" },
    },
    include: {
      homeTeam: true,
      awayTeam: true,
      gameFlags: true,
      picks: { select: { market: true } },
    },
  });

  // latest ModelPrediction per game
  const preds = await prisma.modelPrediction.findMany({
    where: { game: { season, week } },
    orderBy: { generatedAt: "desc" },
  });
  const predByGame = new Map<string, (typeof preds)[number]>();
  for (const p of preds) if (!predByGame.has(p.gameId)) predByGame.set(p.gameId, p);

  const lines = await prisma.line.findMany({
    where: { game: { season, week } },
    select: {
      gameId: true, market: true, lineValue: true,
      sportsbook: true, snapshotType: true, capturedAt: true,
    },
  });
  const consensus = consensusByGame(lines);

  const wxRows = await prisma.weather.findMany({
    where: { game: { season, week } },
    orderBy: { pulledAt: "desc" },
  });
  const windByGame = new Map<string, number | null>();
  for (const w of wxRows) if (!windByGame.has(w.gameId)) windByGame.set(w.gameId, w.windMph);

  const toCreate: Prisma.PickCreateManyInput[] = [];
  const explain: string[] = [];
  const nearMiss: string[] = [];

  const now = Date.now();

  for (const g of games) {
    // Never log a pick on a game that has already kicked off — a pick made
    // after the fact "knows" how the game is going and is worthless for
    // grading. (The board still shows the model's line for finals.)
    if (g.kickoffTime.getTime() <= now) continue;

    const pred = predByGame.get(g.id);
    const c = consensus.get(g.id);
    if (!pred || !c) continue;
    const have = new Set(g.picks.map((p) => p.market));
    const away = g.awayTeam.canonicalName;
    const home = g.homeTeam.canonicalName;
    const label = `${away} @ ${home}`;

    // ---------- SPREAD ----------
    // Lock the pick against a line a book is actually posting, not the
    // inter-book median (which can be a number like -6.3 that you can't bet).
    if (
      !have.has("spread") &&
      pred.predictedSpreadSpPlus != null &&
      c.spreadBook != null
    ) {
      const mSp = pred.predictedSpreadSpPlus;
      const bookSpread = c.spreadBook; // home spread, neg = home favored
      const mktMargin = -bookSpread; // + = home favored by
      const edge = mSp - mktMargin;

      if (Math.abs(edge) >= SPREAD_EDGE_THRESHOLD) {
        if (Math.abs(bookSpread) > LARGE_SPREAD_CAP) {
          nearMiss.push(`${label}: spread edge ${r1(edge)} but market ${r1(bookSpread)} too big`);
        } else {
          const backHome = edge > 0;
          const backedId = backHome ? g.homeTeamId : g.awayTeamId;
          const fadedId = backHome ? g.awayTeamId : g.homeTeamId;
          const backedName = backHome ? home : away;

          const corr: string[] = [];
          // SRS
          const mSrs = pred.predictedSpreadSrs;
          if (mSrs != null) {
            const edgeSrs = mSrs - mktMargin;
            if (sign(edgeSrs) === sign(edge) && Math.abs(edgeSrs) >= SPREAD_EDGE_THRESHOLD) {
              corr.push("srs");
            }
          }
          // flags
          for (const f of g.gameFlags) {
            if (FLAG_HURTS.has(f.flagType) && f.teamId === fadedId) corr.push(f.flagType);
            if (FLAG_HELPS.has(f.flagType) && f.teamId === backedId) corr.push(f.flagType);
          }

          if (corr.length > 0) {
            const method = corr.includes("srs") ? "consensus" : "sp_plus";
            toCreate.push({
              gameId: g.id,
              market: "spread",
              method,
              modelLine: r1(mSp),
              marketLine: r1(mktMargin),
              edge: r1(edge),
              flagsPresent: corr,
            });
            explain.push(
              `SPREAD  ${label}\n    take ${backedName} ${backHome ? r1(bookSpread) : "+" + r1(-bookSpread)}` +
                `  | model ${r1(mSp)} vs market ${r1(mktMargin)} (edge ${r1(edge)})` +
                `  | ${corr.join(", ")}`
            );
          } else {
            nearMiss.push(`${label}: spread edge ${r1(edge)} but nothing corroborates`);
          }
        }
      }
    }

    // ---------- TOTAL ----------
    // Same rule: grade against a total a book actually posts, not the median.
    if (
      !have.has("total") &&
      pred.predictedTotal != null &&
      c.totalBook != null
    ) {
      const bookTotal = c.totalBook;
      const edge = pred.predictedTotal - bookTotal;
      if (Math.abs(edge) >= TOTAL_EDGE_THRESHOLD) {
        const spreadMag =
          c.spreadBook != null ? Math.abs(c.spreadBook) : 0;
        if (spreadMag > TOTALS_COMPETITIVE_CAP) {
          nearMiss.push(`${label}: total edge ${r1(edge)} but game not competitive (spread ${r1(spreadMag)})`);
        } else {
          const over = edge > 0;
          const poss = pred.predictedPossessions ?? null;
          const wind = windByGame.get(g.id) ?? null;
          const corr: string[] = [];
          if (over && poss != null && poss >= FAST_GAME_POSSESSIONS) corr.push("fast_pace");
          if (!over && poss != null && poss <= SLOW_GAME_POSSESSIONS) corr.push("slow_pace");
          if (!over && wind != null && wind >= WIND_UNDER_CORROBORATION) corr.push("wind");

          if (corr.length > 0) {
            toCreate.push({
              gameId: g.id,
              market: "total",
              method: "sp_plus",
              modelLine: r1(pred.predictedTotal),
              marketLine: r1(bookTotal),
              edge: r1(edge),
              flagsPresent: corr,
            });
            explain.push(
              `TOTAL   ${label}\n    ${over ? "OVER" : "UNDER"} ${r1(bookTotal)}` +
                `  | model ${r1(pred.predictedTotal)} (edge ${r1(edge)})` +
                `  | ${corr.join(", ")}`
            );
          } else {
            nearMiss.push(`${label}: total edge ${r1(edge)} (${over ? "over" : "under"}) but pace/wind don't corroborate`);
          }
        }
      }
    }
  }

  if (toCreate.length > 0) await prisma.pick.createMany({ data: toCreate });

  console.log("============================================================");
  console.log(`New picks logged: ${toCreate.length}`);
  console.log("============================================================\n");
  for (const e of explain) console.log("  " + e + "\n");

  if (nearMiss.length > 0) {
    console.log(`Near misses (edge cleared, not logged) — ${nearMiss.length}:`);
    for (const n of nearMiss) console.log(`  - ${n}`);
  }

  const total = await prisma.pick.count({ where: { game: { season, week } } });
  console.log(`\nTotal logged picks for week ${week}: ${total}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
