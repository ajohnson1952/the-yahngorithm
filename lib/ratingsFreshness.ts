// ============================================================
// Is this week's SP+ an in-season number, or still the preseason projection?
// ============================================================
// Bill C's sheet (scripts/loadBillcRatings.ts) is the SP+ source of record
// now — it only "moves" when the operator uploads a new one, which is
// unambiguous. This module exists for the teams still on CFBD's fallback
// (spPlusSource: null) at any given moment: a new/unresolved name, or before
// that week's load-billc upload has happened yet. CFBD's /ratings/sp serves
// ONE live rating per team with no `week` param and strips the postgame
// fields — no flag to read for "is this in-season" — so we detect it
// structurally instead: compare a week's SP+ to the season's earliest
// (week-1, always CFBD) snapshot.
//
// One consumer: tick.ts pulls CFBD ratings ~daily (not just Tuesday) while a
// week isn't `fresh`, so the fallback numbers the board shows before Bill C's
// upload aren't the frozen preseason projection. It no longer gates picks —
// generate-picks requires billc-sourced SP+ outright (week 2+), since
// 2026-09-28.
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
 *  rows are excluded so a billc-covered week can't become its own baseline
 *  (week 1 itself never becomes billc-sourced for FBS teams — see the guard
 *  in loadBillcRatings.ts — so this stays CFBD-pure all season). */
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
