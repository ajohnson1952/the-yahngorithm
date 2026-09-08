import { unstable_cache } from "next/cache";
import { db } from "./db";

/** The CFB season a date belongs to (Jan bowls still belong to the prior year). */
export function currentSeason(now: Date = new Date()): number {
  return now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

/** Once a week's last game kicked off this long ago, that week is "done" and
 *  the site moves on. Sized to keep a Saturday slate up through Sunday morning
 *  for review, but advance by Monday/Tuesday (a Monday-night game clears it by
 *  midday Tuesday). Tune here. */
const WEEK_HOLD_MS = 12 * 3600 * 1000;

/**
 * The week the site should show by default. DB-only — no external calls, and
 * deliberately independent of CFBD's calendar (which rolls over the moment a
 * week technically ends, even while a Monday-night result is still landing).
 *
 * Rule: the earliest week that still has a game to play — i.e. as soon as a
 * week is completely final, advance to the next. Exception: for ~12h after a
 * week's last kickoff we hold on it so results stay up for review instead of
 * jumping to a slate that's still days out.
 */
export async function currentWeek(season: number = currentSeason()): Promise<number> {
  const now = Date.now();

  // earliest week with a game still to come or plausibly in progress. Games
  // long overdue to be marked final (kickoff >18h ago, still not "final") are
  // stale data — ignore them so one bad row can't wedge the site on an old week.
  const pending = await db.game.findFirst({
    where: {
      season,
      status: { not: "final" },
      kickoffTime: { gte: new Date(now - 18 * 3600 * 1000) },
    },
    orderBy: { kickoffTime: "asc" },
    select: { week: true },
  });

  // week of the most recent game to have kicked off inside the hold window —
  // keep it up rather than skipping ahead to a distant next slate
  const held = await db.game.findFirst({
    where: {
      season,
      kickoffTime: { gte: new Date(now - WEEK_HOLD_MS), lte: new Date(now) },
    },
    orderBy: { kickoffTime: "desc" },
    select: { week: true },
  });

  if (pending && held) return Math.min(pending.week, held.week);
  if (pending) return pending.week;
  if (held) return held.week;

  const last = await db.game.findFirst({
    where: { season },
    orderBy: { week: "desc" },
    select: { week: true },
  });
  return last?.week ?? 1;
}

/** Every week number that has at least one game this season, ascending.
 *  Cached 10 min: it changes only when a new week's schedule lands, and it's
 *  hit on every render of most pages (incl. the /watch live-refresh loop).
 *  `groupBy` pushes the dedupe to Postgres — `distinct` doesn't (Prisma
 *  applies it after the rows are already off the wire). */
export const weeksWithGames = unstable_cache(
  async (season: number = currentSeason()): Promise<number[]> => {
    const rows = await db.game.groupBy({
      by: ["week"],
      where: { season },
      orderBy: { week: "asc" },
    });
    return rows.map((r) => r.week);
  },
  ["weeks-with-games"],
  { revalidate: 600, tags: ["weeks-with-games"] }
);
