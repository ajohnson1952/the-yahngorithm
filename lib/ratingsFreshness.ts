// ============================================================
// Is this week's SP+ an in-season number, or still the preseason projection?
// ============================================================
// CFBD's /ratings/sp serves ONE rating per team and strips the postgame
// fields (secondOrderWins / sos are null even for a finished season), so
// there's no flag to read. But Bill Connelly's first in-season revision
// (historically ~week 2-3) shifts essentially every team's number off the
// preseason baseline at once — so we detect it structurally: compare the
// target week's SP+ to the season's earliest snapshot.
//
// Why it matters: pick generation compares the model's margin to the
// market's. Until SP+ has games in it, that's a preseason model vs a
// market that's watched a week of football — the "edge" is mostly the
// model being stale, not a real disagreement. generate-picks holds picks
// for the week until this returns fresh.
// ============================================================

import type { PrismaClient } from "@prisma/client";

export interface SpPlusFreshness {
  fresh: boolean;
  movedPct: number; // fraction of teams that shifted off the baseline
  baselineWeek: number | null;
  comparedTeams: number;
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

  const [all, current] = await Promise.all([
    prisma.teamRatingWeekly.findMany({
      where: { season, spPlusOverall: { not: null } },
      select: { teamId: true, week: true, spPlusOverall: true },
      orderBy: { week: "asc" },
    }),
    prisma.teamRatingWeekly.findMany({
      where: { season, week, spPlusOverall: { not: null } },
      select: { teamId: true, spPlusOverall: true },
    }),
  ]);

  if (current.length === 0) {
    return { fresh: false, movedPct: 0, baselineWeek: null, comparedTeams: 0 };
  }

  const baselineWeek = Math.min(...all.map((r) => r.week));
  if (baselineWeek === week) {
    // no earlier snapshot to compare against — can't confirm it's fresh
    return { fresh: false, movedPct: 0, baselineWeek, comparedTeams: 0 };
  }

  const base = new Map(
    all
      .filter((r) => r.week === baselineWeek)
      .map((r) => [r.teamId, r.spPlusOverall as number])
  );

  let compared = 0;
  let moved = 0;
  for (const r of current) {
    const b = base.get(r.teamId);
    if (b == null) continue;
    compared++;
    if (Math.abs((r.spPlusOverall as number) - b) >= 0.1) moved++;
  }
  const movedPct = compared ? moved / compared : 0;
  return { fresh: movedPct > 0.5, movedPct, baselineWeek, comparedTeams: compared };
}
