// ============================================================
// Totals model
// ============================================================
// Brief's recipe: convert offensive/defensive ratings to points per
// possession, scale by expected game pace, sum both teams, adjust
// for wind. Expected to be noisier than the spread model.
//
// SP+ offense/defense ratings are ~points per game vs an average
// opponent, already pace-normalized — so we combine them, then
// rescale to THIS game's expected possession count.
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

export function totalsModel(i: TotalsInput): TotalsOutput {
  // expected points at average pace = midpoint of (what this offense scores
  // vs an average defense) and (what this defense... i.e. the opponent's D
  // allows vs an average offense).
  const homeBase = (i.homeOffense + i.awayDefense) / 2;
  const awayBase = (i.awayOffense + i.homeDefense) / 2;

  const predictedPossessions = i.homePace + i.awayPace;
  const paceFactor =
    predictedPossessions / (2 * LEAGUE_AVG_POSSESSIONS_PER_TEAM);

  const homeExpectedPts = homeBase * paceFactor;
  const awayExpectedPts = awayBase * paceFactor;

  const wind = i.windMph ?? 0;
  const windAdjustment = Math.min(
    WIND_UNDER_MAX,
    Math.max(0, (wind - WIND_UNDER_THRESHOLD) * WIND_UNDER_PER_MPH)
  );

  const perTeamPossessions = predictedPossessions / 2;
  return {
    homeExpectedPts,
    awayExpectedPts,
    predictedPossessions,
    homeExpectedPpp: homeExpectedPts / perTeamPossessions,
    awayExpectedPpp: awayExpectedPts / perTeamPossessions,
    windAdjustment,
    predictedTotal: homeExpectedPts + awayExpectedPts - windAdjustment,
  };
}
