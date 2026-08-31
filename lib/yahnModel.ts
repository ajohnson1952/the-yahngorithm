// ============================================================
// Yahn model v2 — multi-factor team rating
// ============================================================
// SP+ is the opponent-adjusted-efficiency backbone (don't rebuild it).
// Yahn = SP+ + two bounded, time-decaying adjustments:
//
//   epaAdj    — nudge toward the raw EPA-per-play view of the team.
//               Zero early (EPA is schedule noise before ~week 3),
//               ramps up as the season matures. Ensemble = less
//               single-model variance.
//
//   rosterAdj — what the ROSTER says independent of last year's SP+:
//               247 talent composite (z-scored), returning production
//               (continuity), and net transfer-portal value. Matters
//               most in the preseason; fades to ~0 by week 5 as real
//               results accumulate and SP+ catches up.
//
//   predictedSpreadYahn = yahn(home) - yahn(away) + perTeamHFA(home)
//
// All weights are HEURISTIC — calibrate against closing lines later
// (see memory: yahn-model-v2-plan, build 3). Every adjustment is
// clamped so Yahn can differ from SP+ by a few points, never wildly.
// ============================================================

// --- tunables ---
const PLAYS_PER_TEAM_GAME = 65;

// epaAdj: weight ramps 0 (wk ≤ 1) → EPA_MAX_WEIGHT (wk ≥ EPA_FULL_WEEK)
const EPA_MAX_WEIGHT = 0.3;
const EPA_FULL_WEEK = 8;
const EPA_GAP_CAP = 6; // cap |epaPoints − SP+| before weighting

// rosterAdj: weight decays ROSTER_START_WEIGHT (wk 0) → 0 (wk ≥ ROSTER_ZERO_WEEK)
const ROSTER_START_WEIGHT = 0.33;
const ROSTER_ZERO_WEEK = 5;
// rosterAdj is built from mean-zero DEVIATIONS so it doesn't systematically
// squeeze every spread — it only moves a team where the roster signal
// actually disagrees with SP+.
const TALENT_RATING_PER_SD = 10; // 1 SD of talent ≈ 10 pts on the SP+ scale
const TALENT_NUDGE = 0.25; // how far to pull toward the talent-implied rating
const RETURNING_PTS = 6.0; // (returning% − league mean) × this
const PORTAL_PTS_PER_UNIT = 1.5; // × TeamPortalNet.netScore (net ~0 league-wide)
const ROSTER_GAP_CAP = 4; // cap the raw roster deviation before weighting

export interface YahnTeamInputs {
  spPlusOverall: number | null;
  offPPA: number | null;
  defPPA: number | null;
  talent: number | null;
  returningPct: number | null;
  portalNet: number | null;
}

export interface YahnLeagueContext {
  meanOffPPA: number;
  meanDefPPA: number;
  meanTalent: number;
  sdTalent: number;
  meanReturning: number;
}

export interface YahnTeamRating {
  spBase: number;
  epaAdj: number;
  rosterAdj: number;
  rating: number;
}

const clamp = (x: number, lim: number) => Math.max(-lim, Math.min(lim, x));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function sd(a: number[]): number {
  if (a.length < 2) return 1;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1;
}

const unit = (x: number) => Math.max(0, Math.min(1, x));

/** 0 at week ≤ 1, linearly up to EPA_MAX_WEIGHT at week ≥ EPA_FULL_WEEK. */
export function epaWeight(week: number): number {
  return unit((week - 1) / (EPA_FULL_WEEK - 1)) * EPA_MAX_WEIGHT;
}

/** ROSTER_START_WEIGHT at week 0, linearly to 0 at week ≥ ROSTER_ZERO_WEEK. */
export function rosterWeight(week: number): number {
  return unit((ROSTER_ZERO_WEEK - week) / ROSTER_ZERO_WEEK) * ROSTER_START_WEIGHT;
}

/** Build league context from every rated team's factor rows. */
export function yahnLeagueContext(rows: YahnTeamInputs[]): YahnLeagueContext {
  const off = rows.map((r) => r.offPPA).filter((x): x is number => x != null);
  const def = rows.map((r) => r.defPPA).filter((x): x is number => x != null);
  const tal = rows.map((r) => r.talent).filter((x): x is number => x != null);
  const ret = rows.map((r) => r.returningPct).filter((x): x is number => x != null);
  return {
    meanOffPPA: mean(off),
    meanDefPPA: mean(def),
    meanTalent: mean(tal),
    sdTalent: sd(tal),
    meanReturning: ret.length ? mean(ret) : 0.6,
  };
}

/** One team's Yahn rating (points scale, same as SP+). null if no SP+. */
export function yahnTeamRating(
  t: YahnTeamInputs,
  ctx: YahnLeagueContext,
  week: number
): YahnTeamRating | null {
  if (t.spPlusOverall == null) return null;
  const spBase = t.spPlusOverall;

  // --- EPA adjustment ---
  let epaAdj = 0;
  const ew = epaWeight(week);
  if (ew > 0 && t.offPPA != null && t.defPPA != null) {
    const epaPoints =
      (t.offPPA - ctx.meanOffPPA - (t.defPPA - ctx.meanDefPPA)) * PLAYS_PER_TEAM_GAME;
    epaAdj = ew * clamp(epaPoints - spBase, EPA_GAP_CAP);
  }

  // --- roster adjustment ---
  // Sum of mean-zero deviations, so an average roster gets ≈ 0 (no squeeze):
  //   talent  — nudge toward the talent-implied rating where it disagrees with SP+
  //   return  — continuity above/below the league mean
  //   portal  — net transfer value in vs out (league-wide net ≈ 0)
  let rosterAdj = 0;
  const rw = rosterWeight(week);
  if (rw > 0) {
    let dev = 0;
    if (t.talent != null && ctx.sdTalent > 0) {
      const talentImplied =
        TALENT_RATING_PER_SD * ((t.talent - ctx.meanTalent) / ctx.sdTalent);
      dev += TALENT_NUDGE * (talentImplied - spBase);
    }
    if (t.returningPct != null) {
      dev += RETURNING_PTS * (t.returningPct - ctx.meanReturning);
    }
    if (t.portalNet != null) {
      dev += PORTAL_PTS_PER_UNIT * t.portalNet;
    }
    rosterAdj = rw * clamp(dev, ROSTER_GAP_CAP);
  }

  const r1 = (n: number) => Math.round(n * 100) / 100;
  return {
    spBase: r1(spBase),
    epaAdj: r1(epaAdj),
    rosterAdj: r1(rosterAdj),
    rating: r1(spBase + epaAdj + rosterAdj),
  };
}
