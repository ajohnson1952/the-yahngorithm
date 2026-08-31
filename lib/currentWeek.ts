import { db } from "./db";

/** The CFB season a date belongs to (Jan bowls still belong to the prior year). */
export function currentSeason(now: Date = new Date()): number {
  return now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

/**
 * The week the site should show: the earliest week that still has a game not
 * yet 36h in the past (i.e. this weekend's slate), falling back to the latest
 * week we have games for. DB-only — no external calls.
 */
export async function currentWeek(season: number = currentSeason()): Promise<number> {
  const cutoff = new Date(Date.now() - 36 * 3600 * 1000);
  const upcoming = await db.game.findFirst({
    where: { season, kickoffTime: { gte: cutoff } },
    orderBy: { kickoffTime: "asc" },
    select: { week: true },
  });
  if (upcoming) return upcoming.week;

  const last = await db.game.findFirst({
    where: { season },
    orderBy: { week: "desc" },
    select: { week: true },
  });
  return last?.week ?? 1;
}
