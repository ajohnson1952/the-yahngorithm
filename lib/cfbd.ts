// ============================================================
// CollegeFootballData (CFBD) API helper
// ============================================================
// One authenticated fetch wrapper so every CFBD script isn't
// re-writing the base URL, the Bearer header, and error handling.
// Requires CFBD_API_KEY in the environment (loaded from .env by the
// npm scripts, which run tsx with --env-file=.env).
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CFBD_BASE = "https://api.collegefootballdata.com";

export function requireCfbdKey(): string {
  const key = process.env.CFBD_API_KEY;
  if (!key) {
    console.error(
      "Missing CFBD_API_KEY. Add it to your .env file (get a free key at " +
        "https://collegefootballdata.com/key). Stopping."
    );
    process.exit(1);
  }
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Best-effort call counter for the /admin budget panel. CFBD has no quota
// endpoint, so this is the only signal we have — process-scoped (each
// script run is one process), read via getCfbdCallCount() and persisted
// by the caller (see lib/apiUsage.ts) right before it disconnects.
let cfbdCallCount = 0;
export const getCfbdCallCount = () => cfbdCallCount;

/** GET a CFBD endpoint. `path` is like "/ratings/sp?year=2026".
 *  Retries transient errors (429, 5xx) a few times with backoff. */
export async function cfbdGet<T = unknown>(path: string, attempts = 4): Promise<T> {
  const key = requireCfbdKey();
  const url = path.startsWith("http") ? path : `${CFBD_BASE}${path}`;
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      lastErr = String(e);
      await sleep(500 * 2 ** i);
      continue;
    }
    if (res.ok) {
      cfbdCallCount++;
      return (await res.json()) as T;
    }
    lastErr = `${res.status} ${res.statusText}`;
    if (res.status !== 429 && res.status < 500) break; // client error — don't retry
    await sleep(500 * 2 ** i);
  }
  throw new Error(`CFBD ${path} -> ${lastErr}`);
}

export interface CfbdCalendarWeek {
  season: number;
  week: number;
  seasonType: string; // 'regular' | 'postseason'
  startDate: string;
  endDate: string;
}

/**
 * The CFB season a given date belongs to. The season is named for the year it
 * starts in (Aug–Dec = that year; Jan bowls/playoff still belong to the prior
 * year's season).
 */
export function seasonForDate(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() === 0 ? y - 1 : y; // month 0 = January
}

/**
 * The (season, week) we should be pulling data for right now: the regular-season
 * calendar week whose date range contains `now`. Before the opener -> week 1;
 * after the regular season ends -> the last regular-season week. Scripts can
 * override this with --season/--week flags.
 */
// The season calendar is effectively immutable once published, but ~15 scripts
// call getCurrentSeasonWeek() and the scheduler fires many short-lived runs.
// Two cache layers:
//   1. /tmp file — instant, shared across the steps of ONE runner invocation.
//   2. Meta table — shared across invocations (a fresh runner has an empty /tmp).
// So a live /calendar call happens only ~once a week per season.
const CAL_TMP_TTL_MS = 12 * 60 * 60 * 1000;
const CAL_DB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const calCachePath = (season: number) => join(tmpdir(), `yahn-calendar-${season}.json`);

async function readCalDb(season: number): Promise<CfbdCalendarWeek[] | null> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const p = new PrismaClient();
    try {
      const row = await p.meta.findUnique({ where: { key: `calendar:${season}` } });
      if (row && Date.now() - row.updatedAt.getTime() < CAL_DB_TTL_MS) {
        const cal = row.value as unknown as CfbdCalendarWeek[];
        if (Array.isArray(cal) && cal.length) return cal;
      }
    } finally {
      await p.$disconnect();
    }
  } catch {
    /* no DB / client not generated / offline — fall through */
  }
  return null;
}

async function writeCalDb(season: number, cal: CfbdCalendarWeek[]): Promise<void> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const p = new PrismaClient();
    try {
      const value = cal as unknown as import("@prisma/client").Prisma.InputJsonValue;
      await p.meta.upsert({
        where: { key: `calendar:${season}` },
        update: { value },
        create: { key: `calendar:${season}`, value },
      });
    } finally {
      await p.$disconnect();
    }
  } catch {
    /* best-effort */
  }
}

function readCalCache(season: number): CfbdCalendarWeek[] | null {
  try {
    const raw = JSON.parse(readFileSync(calCachePath(season), "utf8")) as {
      at: number;
      cal: CfbdCalendarWeek[];
    };
    if (Date.now() - raw.at < CAL_TMP_TTL_MS && Array.isArray(raw.cal)) return raw.cal;
  } catch {
    /* no cache / unreadable — fall through to a live fetch */
  }
  return null;
}

function writeCalCache(season: number, cal: CfbdCalendarWeek[]): void {
  try {
    writeFileSync(calCachePath(season), JSON.stringify({ at: Date.now(), cal }));
  } catch {
    /* best-effort */
  }
}

/** Last-resort: figure out the week from games already in our DB — the
 *  earliest week with a game not yet 36 h past, else the latest week we have.
 *  Keeps the whole pipeline alive when CFBD's /calendar is down. */
async function deriveWeekFromGames(season: number, now: Date): Promise<number | null> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const p = new PrismaClient();
    try {
      const cutoff = new Date(now.getTime() - 36 * 60 * 60 * 1000);
      const upcoming = await p.game.findFirst({
        where: { season, kickoffTime: { gte: cutoff } },
        orderBy: { kickoffTime: "asc" },
        select: { week: true },
      });
      if (upcoming) return upcoming.week;
      const last = await p.game.findFirst({
        where: { season },
        orderBy: { week: "desc" },
        select: { week: true },
      });
      return last?.week ?? null;
    } finally {
      await p.$disconnect();
    }
  } catch {
    return null;
  }
}

export async function getCurrentSeasonWeek(
  now: Date = new Date()
): Promise<{ season: number; week: number }> {
  const season = seasonForDate(now);
  let raw = readCalCache(season) ?? (await readCalDb(season));
  if (!raw) {
    try {
      raw = await cfbdGet<CfbdCalendarWeek[]>(`/calendar?year=${season}`);
      await writeCalDb(season, raw);
    } catch (err) {
      const wk = await deriveWeekFromGames(season, now);
      if (wk != null) {
        // warm /tmp (not the DB) with a synthetic 1-week window so the other
        // scripts in this same runner don't each re-hit the dead API.
        writeCalCache(season, [
          {
            season,
            week: wk,
            seasonType: "regular",
            startDate: new Date(now.getTime() - 7 * 864e5).toISOString(),
            endDate: new Date(now.getTime() + 7 * 864e5).toISOString(),
          },
        ]);
        return { season, week: wk };
      }
      throw err;
    }
  }
  writeCalCache(season, raw);
  const cal = raw
    .filter((w) => w.seasonType === "regular")
    .sort((a, b) => a.week - b.week);

  if (cal.length === 0) return { season, week: 1 };

  const t = now.getTime();
  for (const w of cal) {
    if (t >= Date.parse(w.startDate) && t <= Date.parse(w.endDate)) {
      return { season, week: w.week };
    }
  }
  // Not inside any week: before the opener, or after the finale.
  if (t < Date.parse(cal[0].startDate)) return { season, week: cal[0].week };
  return { season, week: cal[cal.length - 1].week };
}
