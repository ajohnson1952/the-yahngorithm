// ============================================================
// Is this week's SP+ an in-season number, or still the preseason projection?
// ============================================================
// CFBD's /ratings/sp serves ONE rating per team and strips the postgame
// fields (secondOrderWins / sos are null even for a finished season), so
// there's no flag to read. But Bill Connelly's first in-season revision
// (historically ~week 2-3) shifts essentially every team's number off the
// preseason baseline at once — so we detect it structurally: compare a
// week's SP+ to the season's earliest snapshot.
//
// Two consumers:
//   - generate-picks holds every pick for a week until this is `fresh`
//     (a preseason model vs a market that's watched a week of football is
//     mostly staleness, not a real edge).
//   - load-billc bridges Bill C's own in-season numbers over the FBS
//     teams while CFBD's feed is still preseason; pull-ratings then leaves
//     those alone until CFBD itself catches up (movedFraction > 0.5).
// ============================================================

import type { PrismaClient } from "@prisma/client";

export interface SpPlusFreshness {
  fresh: boolean;
  movedPct: number; // fraction of teams that shifted off the baseline
  baselineWeek: number | null;
  comparedTeams: number;
}

/** Per-team overall SP+ from the season's earliest CFBD snapshot — the
 *  preseason reference everything else is measured against. Billc-sourced
 *  rows are excluded so a bridged week can't become its own baseline. */
export async function preseasonBaseline(
  prisma: PrismaClient,
  season: number
): Promise<{ week: number | null; overall: Map<string, number> }> {
  const rows = await prisma.teamRatingWeekly.findMany({
    where: { season, spPlusSource: null, spPlusOverall: { not: null } },
    select: { teamId: true, week: true, spPlusOverall: true },
    orderBy: { week: "asc" },
  });
  if (rows.length === 0) return { week: null, overall: new Map() };
  const week = Math.min(...rows.map((r) => r.week));
  return {
    week,
    overall: new Map(
      rows
        .filter((r) => r.week === week)
        .map((r) => [r.teamId, r.spPlusOverall as number])
    ),
  };
}

const MOVE_EPS = 0.1;

/** Fraction of `current` teams whose overall SP+ has moved ≥ MOVE_EPS off the
 *  baseline (i.e. an in-season update has landed). */
export function movedFraction(
  baseline: Map<string, number>,
  current: { teamId: string; overall: number | null }[]
): { movedPct: number; compared: number } {
  let compared = 0;
  let moved = 0;
  for (const c of current) {
    const b = baseline.get(c.teamId);
    if (b == null || c.overall == null) continue;
    compared++;
    if (Math.abs(c.overall - b) >= MOVE_EPS) moved++;
  }
  return { movedPct: compared ? moved / compared : 0, compared };
}

/**
 * Has ONE team's own SP+ actually moved off the preseason baseline?
 *
 * spPlusFreshness()/movedFraction() gate a whole WEEK on an aggregate
 * (>50% of teams moved) — that's enough to detect Bill Connelly's in-season
 * revision landing, but a lower-profile team can still sit on an unrefreshed
 * CFBD number after the week-level gate has already opened because enough
 * OTHER teams moved first. Caught in practice: SDSU/JMU wk3 (2026-09-14) — a
 * pick logged off a rating gap that was byte-identical to their week-2
 * numbers, a full day before CFBD actually recomputed either team.
 *
 * True (pass) by default for a billc-sourced row — the preseason-hold bridge
 * (load-billc) already exists specifically to handle CFBD lag structurally
 * for the whole week; this check targets the OTHER failure mode, a CFBD-
 * sourced row that slipped through stale.
 */
export function teamHasMoved(
  baseline: Map<string, number>,
  teamId: string,
  overall: number | null,
  source: string | null
): boolean {
  if (source === "billc") return true;
  const b = baseline.get(teamId);
  if (b == null || overall == null) return true; // no baseline to compare — don't block
  return Math.abs(overall - b) >= MOVE_EPS;
}

export async function spPlusFreshness(
  prisma: PrismaClient,
  season: number,
  week: number
): Promise<SpPlusFreshness> {
  // Week 1: everyone — including the market — is working off preseason info.
  // There's no "stale" gap to worry about, so don't gate.
  if (week <= 1) {
    return { fresh: true, movedPct: 1, baselineWeek: null, comparedTeams: 0 };
  }

  const [base, current] = await Promise.all([
    preseasonBaseline(prisma, season),
    prisma.teamRatingWeekly.findMany({
      where: { season, week, spPlusOverall: { not: null } },
      select: { teamId: true, spPlusOverall: true },
    }),
  ]);

  if (current.length === 0 || base.week == null || base.week === week) {
    return {
      fresh: false,
      movedPct: 0,
      baselineWeek: base.week,
      comparedTeams: 0,
    };
  }

  const { movedPct, compared } = movedFraction(
    base.overall,
    current.map((r) => ({ teamId: r.teamId, overall: r.spPlusOverall }))
  );
  return {
    fresh: movedPct > 0.5,
    movedPct,
    baselineWeek: base.week,
    comparedTeams: compared,
  };
}
