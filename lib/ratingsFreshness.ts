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
// One consumer: generate-picks holds a pick until this is `fresh` — a
// preseason model vs a market that's watched a week of football is mostly
// staleness, not a real edge. teamHasMoved() is the per-team version, for
// the same reason at finer grain — see its own doc comment.
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

/** Per-team overall SP+ + source for one specific week (not necessarily the
 *  season's first) — the comparison point for {@link teamHasMoved}. */
export async function ratingsAtWeek(
  prisma: PrismaClient,
  season: number,
  week: number
): Promise<Map<string, { overall: number | null; source: string | null }>> {
  const rows = await prisma.teamRatingWeekly.findMany({
    where: { season, week },
    select: { teamId: true, spPlusOverall: true, spPlusSource: true },
  });
  return new Map(
    rows.map((r) => [r.teamId, { overall: r.spPlusOverall, source: r.spPlusSource }])
  );
}

/**
 * Has ONE team's own SP+ actually been refreshed for THIS week — i.e. does
 * it differ from the immediately PRIOR week's number, not just from the
 * season's original preseason baseline?
 *
 * Comparing to preseason isn't enough: a national opponent-adjustment solve
 * moves essentially every team by some nonzero amount each week (every other
 * team's results that week ripple into it), so an exact match to *last*
 * week's number is a strong, reliable signal this particular row is a stale
 * duplicate, not a genuine new read. Comparing to preseason only catches a
 * team frozen since day one; it misses a team that moved once, then had a
 * later week's pull silently fail to refresh.
 *
 * The comparison only means anything when both weeks are CFBD-sourced —
 * comparing a CFBD row to a billc-sourced prior week is apples-to-oranges
 * (billc uses a different, re-centered read; a change between them says
 * nothing about whether CFBD itself has moved). When the prior week isn't a
 * valid same-source comparison, fall back to the preseason baseline instead
 * — confirmed necessary on Old Dominion/Wake Forest wk3 (2026-09-15): wk3
 * (cfbd) looked "moved" vs wk2 (billc-sourced) even though wk3 == wk1
 * exactly, i.e. CFBD had NEVER touched either team.
 *
 * Caveat: this reliably catches a team CFBD hasn't touched AT ALL since its
 * last comparable read (a bit-identical duplicate) — it can't distinguish a
 * genuine small week-to-week nudge from a stale-but-not-frozen intermediate
 * pull, which is closer to what happened on SDSU/JMU wk3 (2026-09-14): both
 * had already moved off preseason during week 2, so even this improved
 * check may not have caught that specific case. No numeric threshold can
 * fully close that gap — it would need a timing rule instead (e.g. only
 * trust a week's SP+ once its Tuesday full pull has landed). This whole
 * function is what actually motivated making Bill C's sheet the SP+ source
 * of record (2026-09-15, see docs/STATUS.md): his upload isn't a "pull" at
 * all, so none of the above applies to a billc-sourced row in the first
 * place — this check only still matters for the shrinking pool of teams on
 * CFBD's fallback.
 *
 * True (pass) by default: no prior week to compare against (week 1, or a
 * team new to our ratings), or the row is billc-sourced (a deliberate
 * upload has no "did this actually refresh" question to ask).
 */
export function teamHasMoved(
  prior: Map<string, { overall: number | null; source: string | null }>,
  preseason: Map<string, number>,
  teamId: string,
  overall: number | null,
  source: string | null,
  week: number
): boolean {
  if (source === "billc" || week <= 1 || overall == null) return true;
  const p = prior.get(teamId);
  const comparePoint =
    p?.overall != null && p.source !== "billc" ? p.overall : preseason.get(teamId);
  if (comparePoint == null) return true; // nothing valid to compare against — don't block
  return Math.abs(overall - comparePoint) >= MOVE_EPS;
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
