// ============================================================
// The model  (PROJECT_BRIEF build step 4)
// ============================================================
// For every FBS-vs-FBS game in the target week that has ratings,
// snapshot a ModelPrediction row: two spread models + one totals
// model.
//
//   predictedSpreadSpPlus = (home_SP+overall - away_SP+overall) + HFA
//   predictedSpreadSrs    = (home_SRS        - away_SRS)         + HFA   (null until SRS exists)
//   predictedTotal        = SP+ off/def -> pts, x expected pace, - wind
//
// Spread margins are "+ = home favored by N". Neutral-site games use
// HFA = 0. No API calls — pure computation on data already pulled.
// Every run inserts a fresh snapshot (never updates).
//
// Prints model-vs-market tables. Does NOT create Pick rows — that
// needs situational-flag corroboration (next build step).
//
// Run:  npm run run-model
//       npm run run-model -- --season 2026 --week 3
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import {
  HOME_FIELD_ADVANTAGE,
  SPREAD_EDGE_THRESHOLD,
  TOTAL_EDGE_THRESHOLD,
  MODEL_DISAGREEMENT_POINTS,
  LEAGUE_AVG_POSSESSIONS_PER_TEAM,
} from "../lib/modelConfig";
import { consensusByGame } from "../lib/consensus";
import { totalsModel } from "../lib/totals";

const prisma = new PrismaClient();

function parseArgs(): { season?: number; week?: number } {
  const args = process.argv.slice(2);
  const val = (flag: string) => {
    const i = args.indexOf(flag);
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

async function main() {
  const override = parseArgs();
  const { season, week } =
    override.season != null && override.week != null
      ? { season: override.season, week: override.week }
      : await getCurrentSeasonWeek();

  console.log(`Model run — season ${season}, week ${week}  (HFA ${HOME_FIELD_ADVANTAGE})\n`);

  const games = await prisma.game.findMany({
    where: {
      season,
      week,
      // at least one FBS team — FBS-vs-FCS now gets a prediction too, since
      // the FCS side has an SP+ rating from the Bill C sheet (load-billc).
      // FCS-vs-FCS is still skipped.
      OR: [
        { homeTeam: { classification: "fbs" } },
        { awayTeam: { classification: "fbs" } },
      ],
    },
    include: { homeTeam: true, awayTeam: true },
  });

  const ratings = await prisma.teamRatingWeekly.findMany({
    where: { season, week },
    select: {
      teamId: true,
      spPlusOverall: true,
      spPlusOffense: true,
      spPlusDefense: true,
      srs: true,
      avgPossessionsPerGame: true,
    },
  });
  const ratingByTeam = new Map(ratings.map((x) => [x.teamId, x]));

  const lines = await prisma.line.findMany({
    where: { game: { season, week } },
    select: {
      gameId: true,
      market: true,
      lineValue: true,
      sportsbook: true,
      snapshotType: true,
      capturedAt: true,
    },
  });
  const consensus = consensusByGame(lines);

  // latest weather snapshot per game
  const wx = await prisma.weather.findMany({
    where: { game: { season, week } },
    orderBy: { pulledAt: "desc" },
  });
  const windByGame = new Map<string, number | null>();
  for (const w of wx) if (!windByGame.has(w.gameId)) windByGame.set(w.gameId, w.windMph);

  const predRows: Prisma.ModelPredictionCreateManyInput[] = [];
  const spreadReport: {
    label: string;
    mSp: number;
    mSrs: number | null;
    mkt: number | null;
    edgeSp: number | null;
    edgeSrs: number | null;
  }[] = [];
  const totalReport: {
    label: string;
    pred: number;
    mkt: number | null;
    edge: number | null;
    wind: number;
    poss: number;
  }[] = [];
  let noRatings = 0;

  for (const g of games) {
    const hr = ratingByTeam.get(g.homeTeamId);
    const ar = ratingByTeam.get(g.awayTeamId);
    if (!hr || !ar || hr.spPlusOverall == null || ar.spPlusOverall == null) {
      noRatings++;
      continue;
    }

    const hfa = g.neutralSite ? 0 : HOME_FIELD_ADVANTAGE;
    const mSp = hr.spPlusOverall - ar.spPlusOverall + hfa;
    const mSrs =
      hr.srs != null && ar.srs != null ? hr.srs - ar.srs + hfa : null;

    // --- totals (only if we have the offense/defense split) ---
    let totals: ReturnType<typeof totalsModel> | null = null;
    if (
      hr.spPlusOffense != null &&
      hr.spPlusDefense != null &&
      ar.spPlusOffense != null &&
      ar.spPlusDefense != null
    ) {
      totals = totalsModel({
        homeOffense: hr.spPlusOffense,
        homeDefense: hr.spPlusDefense,
        homePace: hr.avgPossessionsPerGame ?? LEAGUE_AVG_POSSESSIONS_PER_TEAM,
        awayOffense: ar.spPlusOffense,
        awayDefense: ar.spPlusDefense,
        awayPace: ar.avgPossessionsPerGame ?? LEAGUE_AVG_POSSESSIONS_PER_TEAM,
        windMph: windByGame.get(g.id) ?? null,
      });
    }

    predRows.push({
      gameId: g.id,
      predictedSpreadSpPlus: mSp,
      predictedSpreadSrs: mSrs,
      predictedTotal: totals?.predictedTotal ?? null,
      homeExpectedPpp: totals?.homeExpectedPpp ?? null,
      awayExpectedPpp: totals?.awayExpectedPpp ?? null,
      predictedPossessions: totals?.predictedPossessions ?? null,
    });

    const label = `${g.awayTeam.canonicalName} @ ${g.homeTeam.canonicalName}`;
    const c = consensus.get(g.id);

    // spread: market home margin = -(home spread)
    const mktMargin = c?.spread != null ? -c.spread : null;
    spreadReport.push({
      label,
      mSp,
      mSrs,
      mkt: mktMargin,
      edgeSp: mktMargin != null ? mSp - mktMargin : null,
      edgeSrs: mktMargin != null && mSrs != null ? mSrs - mktMargin : null,
    });

    if (totals) {
      const mktTotal = c?.total ?? null;
      totalReport.push({
        label,
        pred: totals.predictedTotal,
        mkt: mktTotal,
        edge: mktTotal != null ? totals.predictedTotal - mktTotal : null,
        wind: totals.windAdjustment,
        poss: totals.predictedPossessions,
      });
    }
  }

  if (predRows.length > 0) {
    await prisma.modelPrediction.createMany({ data: predRows });
  }

  console.log("============================================================");
  console.log(`ModelPrediction rows written: ${predRows.length}`);
  if (noRatings > 0) console.log(`Games skipped (missing a rating): ${noRatings}`);
  console.log("============================================================\n");

  // ---------- spreads ----------
  const sWithMkt = spreadReport.filter((x) => x.mkt != null);
  sWithMkt.sort((a, b) => Math.abs(b.edgeSp ?? 0) - Math.abs(a.edgeSp ?? 0));
  console.log("SPREADS — model vs market (home margin, + = home favored)\n");
  console.log(
    "  " + "matchup".padEnd(34) + "SP+".padStart(7) + "SRS".padStart(7) +
      "market".padStart(8) + "edge".padStart(7) + "  lean"
  );
  console.log("  " + "-".repeat(72));
  for (const x of sWithMkt) {
    const big = x.edgeSp != null && Math.abs(x.edgeSp) >= SPREAD_EDGE_THRESHOLD;
    const lean = !big
      ? "—"
      : x.edgeSp! > 0
        ? "HOME " + x.label.split(" @ ")[1]
        : "AWAY " + x.label.split(" @ ")[0];
    console.log(
      "  " + x.label.padEnd(34) +
        String(r1(x.mSp)).padStart(7) +
        String(x.mSrs == null ? "-" : r1(x.mSrs)).padStart(7) +
        String(r1(x.mkt!)).padStart(8) +
        String(x.edgeSp == null ? "-" : r1(x.edgeSp)).padStart(7) +
        "  " + lean + (big ? " *" : "")
    );
  }
  const sCand = sWithMkt.filter(
    (x) => x.edgeSp != null && Math.abs(x.edgeSp) >= SPREAD_EDGE_THRESHOLD
  );
  console.log(
    `\n* ${sCand.length} spread(s) over the ${SPREAD_EDGE_THRESHOLD}-pt threshold ` +
      "(before the large-spread filter and flag corroboration — not picks yet).\n"
  );

  // ---------- totals ----------
  const tWithMkt = totalReport.filter((x) => x.mkt != null);
  tWithMkt.sort((a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0));
  console.log("TOTALS — model vs market\n");
  console.log(
    "  " + "matchup".padEnd(34) + "model".padStart(7) + "market".padStart(8) +
      "edge".padStart(7) + "wind".padStart(6) + "poss".padStart(6) + "  lean"
  );
  console.log("  " + "-".repeat(76));
  for (const x of tWithMkt) {
    const big = x.edge != null && Math.abs(x.edge) >= TOTAL_EDGE_THRESHOLD;
    const lean = !big ? "—" : x.edge! > 0 ? "OVER" : "UNDER";
    console.log(
      "  " + x.label.padEnd(34) +
        String(r1(x.pred)).padStart(7) +
        String(r1(x.mkt!)).padStart(8) +
        String(x.edge == null ? "-" : r1(x.edge)).padStart(7) +
        String(r1(x.wind)).padStart(6) +
        String(r1(x.poss)).padStart(6) +
        "  " + lean + (big ? " *" : "")
    );
  }
  const tCand = tWithMkt.filter(
    (x) => x.edge != null && Math.abs(x.edge) >= TOTAL_EDGE_THRESHOLD
  );
  const noMktT = totalReport.length - tWithMkt.length;
  console.log(
    `\n* ${tCand.length} total(s) over the ${TOTAL_EDGE_THRESHOLD}-pt threshold. ` +
      `${noMktT} predicted with no market total yet.`
  );
  console.log("  (Totals are noisier than spreads — weight accordingly. See GUIDE §3.)");

  // SRS note
  if (spreadReport.some((x) => x.mSrs != null)) {
    const dis = spreadReport.filter(
      (x) => x.mSrs != null && Math.abs(x.mSp - x.mSrs!) > MODEL_DISAGREEMENT_POINTS
    ).length;
    console.log(`\nSP+/SRS disagree by >${MODEL_DISAGREEMENT_POINTS} pts on ${dis} game(s).`);
  } else {
    console.log("\nSRS not available yet — spread signal is SP+ only.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
