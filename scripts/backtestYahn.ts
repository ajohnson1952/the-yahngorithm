// ============================================================
// Quick Yahn v2 backtest — 2025 completed season
// ============================================================
// Question: does layering EPA + roster + per-team HFA onto SP+ (= the
// Yahn v2 model) predict game margins any better than plain SP+, and
// does either beat the closing line?
//
// CAVEAT — this is the *quick* version:
//   - Uses END-OF-SEASON 2025 SP+ / advanced stats as the rating for
//     every week (we don't store point-in-time history yet). That's
//     hindsight: it makes BOTH SP+ and Yahn look too good vs the close
//     in absolute terms. The SP+-vs-Yahn *delta* is still fair (same
//     hindsight in both), and that delta is the thing we care about.
//   - roster/EPA time-decay uses each game's real week number.
//
// Run:  npm run backtest-yahn
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";
import { median } from "../lib/consensus";
import {
  yahnLeagueContext,
  yahnTeamRating,
  type YahnTeamInputs,
} from "../lib/yahnModel";

const prisma = new PrismaClient();
const SEASON = 2025;
const FLAT_HFA = 2.5;

interface SpRow {
  team: string;
  rating: number | null;
  offense?: { rating: number | null } | null;
  defense?: { rating: number | null } | null;
}

const mae = (a: number[]) => a.reduce((s, x) => s + Math.abs(x), 0) / a.length;
const rmse = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");

async function main() {
  console.log(`Yahn v2 backtest — ${SEASON} (end-of-season ratings; see caveat)\n`);

  const resolver = await buildTeamResolver(prisma, "cfbd");
  const sp = await cfbdGet<SpRow[]>(`/ratings/sp?year=${SEASON}`);
  const spById = new Map<string, { o: number; off: number | null; def: number | null }>();
  for (const r of sp) {
    if (!r.team || r.team === "nationalAverages" || r.rating == null) continue;
    const id = resolver.resolve(r.team);
    if (id) spById.set(id, { o: r.rating, off: r.offense?.rating ?? null, def: r.defense?.rating ?? null });
  }

  const [games, lines, talent, returning, portal, adv, hfa] = await Promise.all([
    prisma.game.findMany({
      where: { season: SEASON, status: "final", homeScore: { not: null }, awayScore: { not: null } },
      select: {
        id: true, week: true, neutralSite: true,
        homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true,
      },
    }),
    prisma.line.findMany({
      where: { game: { season: SEASON }, market: "spread", snapshotType: "close" },
      select: { gameId: true, lineValue: true },
    }),
    prisma.teamTalent.findMany({ where: { season: SEASON }, select: { teamId: true, talent: true } }),
    prisma.teamReturningProduction.findMany({ where: { season: SEASON }, select: { teamId: true, percentPPA: true } }),
    prisma.teamPortalNet.findMany({ where: { season: SEASON }, select: { teamId: true, netScore: true } }),
    prisma.teamAdvancedWeekly.findMany({ where: { season: SEASON }, orderBy: { week: "desc" } }),
    prisma.teamHfa.findMany({ select: { teamId: true, hfa: true } }),
  ]);

  const closeByGame = new Map<string, number>();
  const spreadsByGame = new Map<string, number[]>();
  for (const l of lines) {
    const a = spreadsByGame.get(l.gameId) ?? [];
    a.push(l.lineValue);
    spreadsByGame.set(l.gameId, a);
  }
  for (const [gid, arr] of spreadsByGame) {
    const m = median(arr);
    if (m != null) closeByGame.set(gid, m); // home spread, neg = home favored
  }

  const advByTeam = new Map<string, (typeof adv)[number]>();
  for (const a of adv) if (!advByTeam.has(a.teamId)) advByTeam.set(a.teamId, a);
  const talentBy = new Map(talent.map((r) => [r.teamId, r.talent]));
  const retBy = new Map(returning.map((r) => [r.teamId, r.percentPPA]));
  const portalBy = new Map(portal.map((r) => [r.teamId, r.netScore]));
  const hfaBy = new Map(hfa.map((r) => [r.teamId, r.hfa]));

  const inputs = (teamId: string): YahnTeamInputs => {
    const a = advByTeam.get(teamId);
    return {
      spPlusOverall: spById.get(teamId)?.o ?? null,
      offPPA: a?.offPPA ?? null,
      defPPA: a?.defPPA ?? null,
      talent: talentBy.get(teamId) ?? null,
      returningPct: retBy.get(teamId) ?? null,
      portalNet: portalBy.get(teamId) ?? null,
    };
  };
  const ctx = yahnLeagueContext([...spById.keys()].map((id) => inputs(id)));

  // ---- run every game ----
  type Row = {
    week: number;
    actual: number;
    close: number;
    sp: number;
    yahn: number;
  };
  const rows: Row[] = [];
  for (const g of games) {
    const close = closeByGame.get(g.id);
    const sh = spById.get(g.homeTeamId);
    const sa = spById.get(g.awayTeamId);
    if (close == null || !sh || !sa) continue;
    const hfaFlat = g.neutralSite ? 0 : FLAT_HFA;
    const spMargin = sh.o - sa.o + hfaFlat;
    const yh = yahnTeamRating(inputs(g.homeTeamId), ctx, g.week);
    const ya = yahnTeamRating(inputs(g.awayTeamId), ctx, g.week);
    if (!yh || !ya) continue;
    const yHfa = g.neutralSite ? 0 : hfaBy.get(g.homeTeamId) ?? FLAT_HFA;
    const yahnMargin = yh.rating - ya.rating + yHfa;
    rows.push({
      week: g.week,
      actual: g.homeScore! - g.awayScore!,
      close: -close, // home margin implied by the closing line
      sp: spMargin,
      yahn: yahnMargin,
    });
  }

  console.log(`Games scored: ${rows.length}\n`);

  // ---- 1. raw accuracy vs actual margin ----
  const errClose = rows.map((r) => r.close - r.actual);
  const errSp = rows.map((r) => r.sp - r.actual);
  const errYahn = rows.map((r) => r.yahn - r.actual);
  console.log("ACCURACY vs actual margin (lower = better)");
  console.log(`  ${"".padEnd(16)}${"MAE".padStart(8)}${"RMSE".padStart(8)}`);
  console.log(`  ${"closing line".padEnd(16)}${mae(errClose).toFixed(2).padStart(8)}${rmse(errClose).toFixed(2).padStart(8)}`);
  console.log(`  ${"SP+ model".padEnd(16)}${mae(errSp).toFixed(2).padStart(8)}${rmse(errSp).toFixed(2).padStart(8)}`);
  console.log(`  ${"Yahn v2 model".padEnd(16)}${mae(errYahn).toFixed(2).padStart(8)}${rmse(errYahn).toFixed(2).padStart(8)}`);

  // ---- 2. ATS vs the closing line, at edge thresholds ----
  const atsAtEdge = (pick: (r: Row) => number, edge: number) => {
    let w = 0, l = 0, p = 0;
    for (const r of rows) {
      const diff = pick(r) - r.close; // model vs line
      if (Math.abs(diff) < edge) continue;
      const cover = r.actual - r.close; // + = home covered the close
      if (Math.abs(cover) < 1e-9) { p++; continue; }
      if (Math.sign(diff) === Math.sign(cover)) w++;
      else l++;
    }
    return { w, l, p, n: w + l };
  };
  console.log("\nATS vs the CLOSING LINE  (bet the side the model favors; break-even ≈ 52.4%)");
  for (const edge of [0, 1.5, 2.5, 4]) {
    const s = atsAtEdge((r) => r.sp, edge);
    const y = atsAtEdge((r) => r.yahn, edge);
    console.log(
      `  edge ≥ ${edge.toFixed(1).padStart(3)}   ` +
        `SP+  ${`${s.w}-${s.l}`.padEnd(9)} ${pct(s.w, s.n).padStart(7)} (${String(s.n).padStart(3)})    ` +
        `Yahn ${`${y.w}-${y.l}`.padEnd(9)} ${pct(y.w, y.n).padStart(7)} (${String(y.n).padStart(3)})`
    );
  }

  // ---- 3. head-to-head where they disagree ----
  const disagree = rows.filter((r) => Math.abs(r.yahn - r.sp) >= 1);
  let yahnCloser = 0, spCloser = 0;
  let yahnAtsW = 0, yahnAtsL = 0; // on the disagreement, bet Yahn's side vs close
  for (const r of disagree) {
    if (Math.abs(r.yahn - r.actual) < Math.abs(r.sp - r.actual)) yahnCloser++;
    else spCloser++;
    // the games where Yahn moves the number toward/away from the close
    const diff = r.yahn - r.close;
    const cover = r.actual - r.close;
    if (Math.abs(diff) < 1e-9 || Math.abs(cover) < 1e-9) continue;
    if (Math.sign(diff) === Math.sign(cover)) yahnAtsW++;
    else yahnAtsL++;
  }
  console.log(
    `\nWHERE YAHN ≠ SP+ by ≥1 pt  (${disagree.length} games, ` +
      `avg move ${mae(disagree.map((r) => r.yahn - r.sp)).toFixed(2)} pt)`
  );
  console.log(`  Yahn closer to actual: ${yahnCloser}   SP+ closer: ${spCloser}   ` +
    `(${pct(yahnCloser, yahnCloser + spCloser)} Yahn)`);
  console.log(`  Betting Yahn's side vs the close on those games: ${yahnAtsW}-${yahnAtsL} ` +
    `(${pct(yahnAtsW, yahnAtsW + yahnAtsL)})`);

  // ---- 4. by season phase (roster weight decays after wk 5) ----
  console.log("\nBY PHASE  (Yahn closer to actual than SP+, %)");
  for (const [label, lo, hi] of [["weeks 1-3", 1, 3], ["weeks 4-6", 4, 6], ["weeks 7+", 7, 99]] as const) {
    const seg = rows.filter((r) => r.week >= lo && r.week <= hi);
    let yc = 0, sc = 0;
    for (const r of seg) {
      if (Math.abs(r.yahn - r.sp) < 0.5) continue;
      if (Math.abs(r.yahn - r.actual) < Math.abs(r.sp - r.actual)) yc++;
      else sc++;
    }
    const segMaeSp = mae(seg.map((r) => r.sp - r.actual));
    const segMaeY = mae(seg.map((r) => r.yahn - r.actual));
    console.log(
      `  ${label.padEnd(10)} n=${String(seg.length).padStart(3)}   ` +
        `Yahn-closer ${pct(yc, yc + sc).padStart(7)}   ` +
        `MAE  SP+ ${segMaeSp.toFixed(2)}  Yahn ${segMaeY.toFixed(2)}`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
