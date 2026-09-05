import { unstable_cache } from "next/cache";
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
