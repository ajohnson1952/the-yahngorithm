// ============================================================
// Yahn calibration harness — walk-forward backtest
// ============================================================
// For every historical FBS-vs-FBS game with a closing line, assemble
// the feature vector KNOWN BEFORE that game (point-in-time as-of
// margin rating + cumulative EPA + static roster factors + per-team
// HFA), then compare models:
//
//   close        the market (closing consensus spread)
//   asof         our point-in-time opponent-adjusted margin + flat HFA
//   yahn-heur    asof + the current lib/yahnModel heuristic adjustments
//   yahn-fit     ridge regression fit on the features (walk-forward:
//                trained only on seasons strictly before the test one)
//   yahn-mkt     ridge fit to predict (actual − close): the market
//                residual — this is the "is there an edge" model
//
// Metrics: MAE/RMSE vs the actual margin; ATS record vs the closing
// line at several edge thresholds, with a binomial confidence band.
// All split by season phase.
//
// Run:  npm run backtest-harness
// ============================================================

import { PrismaClient } from "@prisma/client";
import {
  yahnLeagueContext,
  yahnTeamRating,
  type YahnTeamInputs,
} from "../lib/yahnModel";
import { median } from "../lib/consensus";

const prisma = new PrismaClient();

const TRAIN_SEASONS = [2018, 2019, 2021, 2022, 2023, 2024, 2025];
const TEST_SEASONS = [2023, 2024, 2025];
const FLAT_HFA = 2.7;
const RIDGE = 0.5;

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const mae = (a: number[]) => mean(a.map(Math.abs));
const rmse = (a: number[]) => Math.sqrt(mean(a.map((x) => x * x)));
function stdev(a: number[]): number {
  if (a.length < 2) return 1;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1;
}

function solveSPD(A: number[][], b: number[]): number[] {
  const n = b.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j];
    }
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/** ridge: β = (XᵀX + λI)⁻¹ Xᵀy  (no penalty on the intercept, col 0) */
function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0].length;
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < p; i++) {
      b[i] += X[r][i] * y[r];
      for (let j = 0; j < p; j++) A[i][j] += X[r][i] * X[r][j];
    }
  }
  for (let i = 1; i < p; i++) A[i][i] += lambda;
  return solveSPD(A, b);
}
const predict = (x: number[], beta: number[]) => x.reduce((s, xi, i) => s + xi * beta[i], 0);

const FEATURES = ["intercept", "homeField", "asofDiff", "epaDiff", "talentZDiff", "returnDevDiff", "portalDiff", "hfaExcess"] as const;

interface Row {
  season: number;
  week: number;
  actual: number;
  close: number; // home margin implied by close
  x: number[]; // feature vector (FEATURES order)
  yahnHeur: number;
}

async function build(): Promise<Row[]> {
  const fbs = new Set(
    (await prisma.team.findMany({ where: { classification: "fbs" }, select: { id: true } })).map((t) => t.id)
  );

  const rows: Row[] = [];

  for (const season of TRAIN_SEASONS) {
    const [games, lines, asof, adv, talent, returning, portal, hfa] = await Promise.all([
      prisma.game.findMany({
        where: { season, status: "final", homeScore: { not: null }, awayScore: { not: null } },
        select: { id: true, week: true, neutralSite: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
      }),
      prisma.line.findMany({
        where: { game: { season }, market: "spread", snapshotType: "close" },
        select: { gameId: true, lineValue: true },
      }),
      prisma.teamRatingAsOf.findMany({ where: { season }, select: { teamId: true, throughWeek: true, rating: true } }),
      prisma.teamAdvancedWeekly.findMany({ where: { season }, select: { teamId: true, week: true, offPPA: true, defPPA: true } }),
      prisma.teamTalent.findMany({ where: { season }, select: { teamId: true, talent: true } }),
      prisma.teamReturningProduction.findMany({ where: { season }, select: { teamId: true, percentPPA: true } }),
      prisma.teamPortalNet.findMany({ where: { season }, select: { teamId: true, netScore: true } }),
      prisma.teamHfa.findMany({ select: { teamId: true, hfa: true } }),
    ]);

    // closing consensus
    const spreads = new Map<string, number[]>();
    for (const l of lines) (spreads.get(l.gameId) ?? spreads.set(l.gameId, []).get(l.gameId)!).push(l.lineValue);
    const closeBy = new Map<string, number>();
    for (const [g, arr] of spreads) {
      const m = median(arr);
      if (m != null) closeBy.set(g, -m); // home margin
    }

    // as-of rating: teamId -> throughWeek -> rating
    const asofBy = new Map<string, Map<number, number>>();
    for (const r of asof) (asofBy.get(r.teamId) ?? asofBy.set(r.teamId, new Map()).get(r.teamId)!).set(r.throughWeek, r.rating);
    const asofAt = (id: string, tw: number) => {
      const m = asofBy.get(id);
      if (!m) return null;
      for (let w = Math.min(tw, 15); w >= 0; w--) if (m.has(w)) return m.get(w)!;
      return null;
    };

    // EPA checkpoints: teamId -> [ {week, net} ] ascending
    const advBy = new Map<string, { week: number; net: number }[]>();
    for (const a of adv) {
      if (a.offPPA == null || a.defPPA == null) continue;
      (advBy.get(a.teamId) ?? advBy.set(a.teamId, []).get(a.teamId)!).push({ week: a.week, net: a.offPPA - a.defPPA });
    }
    for (const v of advBy.values()) v.sort((x, y) => x.week - y.week);
    const epaBefore = (id: string, wk: number) => {
      const v = advBy.get(id);
      if (!v) return null;
      let best: number | null = null;
      for (const c of v) if (c.week < wk) best = c.net;
      return best;
    };

    const talVals = talent.map((t) => t.talent);
    const tMean = mean(talVals), tSd = stdev(talVals);
    const talZ = new Map(talent.map((t) => [t.teamId, (t.talent - tMean) / tSd]));
    const retVals = returning.map((r) => r.percentPPA).filter((x): x is number => x != null);
    const retMean = mean(retVals);
    const retDev = new Map(returning.map((r) => [r.teamId, r.percentPPA != null ? r.percentPPA - retMean : 0]));
    const portalBy = new Map(portal.map((r) => [r.teamId, r.netScore]));
    const hfaBy = new Map(hfa.map((r) => [r.teamId, r.hfa]));

    // Yahn heuristic needs a league context; reuse the model's own using
    // as-of rating as the "spPlusOverall" base.
    const ctxInputs = (id: string): YahnTeamInputs => ({
      spPlusOverall: asofAt(id, 15),
      offPPA: null,
      defPPA: null,
      talent: talZ.has(id) ? talZ.get(id)! * tSd + tMean : null,
      returningPct: returning.find((r) => r.teamId === id)?.percentPPA ?? null,
      portalNet: portalBy.get(id) ?? null,
    });
    const ctx = yahnLeagueContext([...asofBy.keys()].map(ctxInputs));

    for (const g of games) {
      const close = closeBy.get(g.id);
      if (close == null || !fbs.has(g.homeTeamId) || !fbs.has(g.awayTeamId)) continue;
      const tw = g.week - 1;
      const ah = asofAt(g.homeTeamId, tw);
      const aa = asofAt(g.awayTeamId, tw);
      if (ah == null || aa == null) continue;

      const epaH = epaBefore(g.homeTeamId, g.week);
      const epaA = epaBefore(g.awayTeamId, g.week);
      const homeField = g.neutralSite ? 0 : 1;
      const x = [
        1,
        homeField,
        ah - aa,
        (epaH ?? 0) - (epaA ?? 0),
        (talZ.get(g.homeTeamId) ?? 0) - (talZ.get(g.awayTeamId) ?? 0),
        (retDev.get(g.homeTeamId) ?? 0) - (retDev.get(g.awayTeamId) ?? 0),
        (portalBy.get(g.homeTeamId) ?? 0) - (portalBy.get(g.awayTeamId) ?? 0),
        homeField ? (hfaBy.get(g.homeTeamId) ?? FLAT_HFA) - FLAT_HFA : 0,
      ];

      // yahn heuristic prediction, as-of base
      const inp = (id: string, ep: number | null): YahnTeamInputs => ({
        spPlusOverall: id === g.homeTeamId ? ah : aa,
        offPPA: ep, defPPA: 0,
        talent: talZ.has(id) ? talZ.get(id)! * tSd + tMean : null,
        returningPct: returning.find((r) => r.teamId === id)?.percentPPA ?? null,
        portalNet: portalBy.get(id) ?? null,
      });
      const yh = yahnTeamRating(inp(g.homeTeamId, epaH), ctx, g.week);
      const ya = yahnTeamRating(inp(g.awayTeamId, epaA), ctx, g.week);
      const yHfa = homeField ? hfaBy.get(g.homeTeamId) ?? FLAT_HFA : 0;
      const yahnHeur = yh && ya ? yh.rating - ya.rating + yHfa : ah - aa + (homeField ? FLAT_HFA : 0);

      rows.push({
        season, week: g.week,
        actual: g.homeScore! - g.awayScore!,
        close,
        x, yahnHeur,
      });
    }
  }
  return rows;
}

function ats(preds: number[], rows: Row[], edge: number) {
  let w = 0, l = 0, p = 0;
  for (let i = 0; i < rows.length; i++) {
    const diff = preds[i] - rows[i].close;
    if (Math.abs(diff) < edge) continue;
    const cover = rows[i].actual - rows[i].close;
    if (Math.abs(cover) < 1e-9) { p++; continue; }
    if (Math.sign(diff) === Math.sign(cover)) w++; else l++;
  }
  const n = w + l;
  const rate = n ? w / n : 0;
  const se = n ? Math.sqrt((rate * (1 - rate)) / n) : 0;
  return { w, l, p, n, rate, lo: rate - 1.96 * se, hi: rate + 1.96 * se };
}

async function main() {
  console.log("Yahn calibration harness — walk-forward\n");
  const all = await build();
  console.log(`FBS-vs-FBS games with a closing line: ${all.length}\n`);

  const testRows: Row[] = [];
  const predClose: number[] = [], predAsof: number[] = [], predHeur: number[] = [], predFit: number[] = [], predMkt: number[] = [], predEpa: number[] = [];
  const EPA_I = FEATURES.indexOf("epaDiff" as never);

  for (const S of TEST_SEASONS) {
    const train = all.filter((r) => r.season < S);
    const test = all.filter((r) => r.season === S);
    const betaAbs = ridgeFit(train.map((r) => r.x), train.map((r) => r.actual), RIDGE);
    const betaMkt = ridgeFit(train.map((r) => r.x), train.map((r) => r.actual - r.close), RIDGE);
    // univariate: market residual explained by EPA edge alone
    const betaEpa = ridgeFit(train.map((r) => [1, r.x[EPA_I]]), train.map((r) => r.actual - r.close), RIDGE);

    if (S === TEST_SEASONS[TEST_SEASONS.length - 1]) {
      console.log(`Fitted coefficients (train < ${S}):`);
      FEATURES.forEach((f, i) => console.log(`  ${f.padEnd(14)} abs ${betaAbs[i].toFixed(3).padStart(8)}   mkt-resid ${betaMkt[i].toFixed(3).padStart(8)}`));
      console.log();
    }

    for (const r of test) {
      testRows.push(r);
      predClose.push(r.close);
      predAsof.push(r.x[2] + (r.x[1] ? FLAT_HFA : 0));
      predHeur.push(r.yahnHeur);
      predFit.push(predict(r.x, betaAbs));
      predMkt.push(r.close + predict(r.x, betaMkt));
      predEpa.push(r.close + predict([1, r.x[EPA_I]], betaEpa));
    }
  }

  const models: [string, number[]][] = [
    ["close (market)", predClose],
    ["asof margin", predAsof],
    ["yahn heuristic", predHeur],
    ["yahn fitted", predFit],
    ["yahn vs-market", predMkt],
    ["EPA-only vs mkt", predEpa],
  ];

  console.log("ACCURACY vs actual margin (test seasons " + TEST_SEASONS.join("/") + ", n=" + testRows.length + ")");
  console.log(`  ${"model".padEnd(16)}${"MAE".padStart(8)}${"RMSE".padStart(8)}`);
  for (const [name, pred] of models) {
    const err = pred.map((p, i) => p - testRows[i].actual);
    console.log(`  ${name.padEnd(16)}${mae(err).toFixed(2).padStart(8)}${rmse(err).toFixed(2).padStart(8)}`);
  }

  console.log("\nATS vs the CLOSING LINE  (break-even 52.4%; [95% CI])");
  for (const edge of [0, 1, 2, 3]) {
    console.log(`  edge ≥ ${edge}`);
    for (const [name, pred] of models) {
      if (name.startsWith("close")) continue;
      const a = ats(pred, testRows, edge);
      const flag = a.lo > 0.524 ? "  <-- CI clears break-even" : "";
      console.log(
        `    ${name.padEnd(16)} ${`${a.w}-${a.l}`.padEnd(10)} ${(100 * a.rate).toFixed(1)}%  ` +
          `[${(100 * a.lo).toFixed(1)}–${(100 * a.hi).toFixed(1)}]  n=${String(a.n).padStart(4)}${flag}`
      );
    }
  }

  console.log("\nBY PHASE  (yahn vs-market model, ATS edge ≥ 2)");
  for (const [label, lo, hi] of [["weeks 1-4", 1, 4], ["weeks 5-8", 5, 8], ["weeks 9+", 9, 99]] as const) {
    const idxs = testRows.map((r, i) => (r.week >= lo && r.week <= hi ? i : -1)).filter((i) => i >= 0);
    const sub = idxs.map((i) => testRows[i]);
    const subPred = idxs.map((i) => predMkt[i]);
    const a = ats(subPred, sub, 2);
    const errFit = idxs.map((i) => predFit[i] - testRows[i].actual);
    const errAsof = idxs.map((i) => predAsof[i] - testRows[i].actual);
    console.log(
      `  ${label.padEnd(10)} ATS ${`${a.w}-${a.l}`.padEnd(9)} ${(100 * a.rate).toFixed(1)}% [${(100 * a.lo).toFixed(1)}–${(100 * a.hi).toFixed(1)}]  ` +
        `| MAE asof ${mae(errAsof).toFixed(2)} → fitted ${mae(errFit).toFixed(2)}`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
