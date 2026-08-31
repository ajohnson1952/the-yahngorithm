// ============================================================
// Totals model
// ============================================================
// The SP+ offense/defense split is good at estimating the *combined*
// total. It is NOT used to estimate the margin — the spread model owns
// that. We take the total from here, the margin from the spread model,
// and split: homePts = (total + margin) / 2, awayPts = (total - margin) / 2.
// So the two models can never contradict each other.
//
// SP+ offense/defense are ~points per game vs an average opponent,
// already pace-normalized — combine them, then rescale to THIS game's
// expected possession count.
// ============================================================

import {
  LEAGUE_AVG_POSSESSIONS_PER_TEAM,
  WIND_UNDER_THRESHOLD,
  WIND_UNDER_PER_MPH,
  WIND_UNDER_MAX,
} from "./modelConfig";

export interface TotalsInput {
  homeOffense: number;
  homeDefense: number;
  homePace: number;
  awayOffense: number;
  awayDefense: number;
  awayPace: number;
  /** SP+ predicted home margin (+ = home favored), HFA included — the split point. */
  spreadMargin: number;
  windMph?: number | null;
}

export interface TotalsOutput {
  homeExpectedPts: number;
  awayExpectedPts: number;
  predictedPossessions: number; // both teams combined
  homeExpectedPpp: number;
  awayExpectedPpp: number;
  windAdjustment: number; // points removed for wind
  predictedTotal: number;
}

const SCORE_FLOOR = 7; // nobody is projected below ~a TD, even in a blowout

export function totalsModel(i: TotalsInput): TotalsOutput {
  // expected points at average pace = midpoint of (what this offense scores
  // vs an average defense) and (what the opponent's defense allows vs an
  // average offense).
  const homeBase = (i.homeOffense + i.awayDefense) / 2;
  const awayBase = (i.awayOffense + i.homeDefense) / 2;

  const predictedPossessions = i.homePace + i.awayPace;
  const paceFactor =
    predictedPossessions / (2 * LEAGUE_AVG_POSSESSIONS_PER_TEAM);

  const wind = i.windMph ?? 0;
  const windAdjustment = Math.min(
    WIND_UNDER_MAX,
    Math.max(0, (wind - WIND_UNDER_THRESHOLD) * WIND_UNDER_PER_MPH)
  );

  const predictedTotal = (homeBase + awayBase) * paceFactor - windAdjustment;

  // split the total around the SPREAD model's margin, so spread and total agree
  let homeExpectedPts = (predictedTotal + i.spreadMargin) / 2;
  let awayExpectedPts = (predictedTotal - i.spreadMargin) / 2;
  // clamp the underdog to a floor on lopsided games (the total holds; the
  // implied margin compresses a bit, which is the right direction anyway —
  // big favorites don't cover their raw rating edge, see GUIDE §2/§3)
  if (awayExpectedPts < SCORE_FLOOR) {
    awayExpectedPts = SCORE_FLOOR;
    homeExpectedPts = predictedTotal - SCORE_FLOOR;
  } else if (homeExpectedPts < SCORE_FLOOR) {
    homeExpectedPts = SCORE_FLOOR;
    awayExpectedPts = predictedTotal - SCORE_FLOOR;
  }

  const perTeamPossessions = predictedPossessions / 2;
  return {
    homeExpectedPts,
    awayExpectedPts,
    predictedPossessions,
    homeExpectedPpp: homeExpectedPts / perTeamPossessions,
    awayExpectedPpp: awayExpectedPts / perTeamPossessions,
    windAdjustment,
    predictedTotal,
  };
}
