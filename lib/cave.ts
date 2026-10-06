// ============================================================
// "How the cave picked it" — Cavepicks' locked-pick counts per game.
// ============================================================
// Cavepicks (the owner's pick'em app, 7 friends) publishes, per game, how
// many LOCKED picks sit on each side — counts only, no names. This maps those
// onto our games (via the Odds API team names both apps share) for the board
// chip and the game page.
//
// Cached with the rest of the pipeline data: fetched at most once per tick
// (and warmed by the tick's page loads), so visitors never trigger a call to
// Cavepicks, and Cavepicks serves it from its own cache without touching its
// database. A failed fetch just means no chips until the next tick.
// ============================================================

import { unstable_cache } from "next/cache";
import { getWeekBoard } from "./webData";
import { cachedOddsNames } from "./feed";
import { PIPELINE_TAG, PIPELINE_TTL } from "./pipelineCache";

export const CAVEPICKS_URL = "https://www.cavepicks.com";

export interface CaveSplit {
  /** different players with a locked pick on this game */
  players: number;
  leagueSize: number;
  spread: { home: number; away: number };
  total: { over: number; under: number };
  dog: { home: number; away: number };
  /** every locked pick on the game, all markets */
  picks: number;
}

interface RawGame {
  home: string;
  away: string;
  players: number;
  spread: { home: number; away: number };
  total: { over: number; under: number };
  dog: { home: number; away: number };
}

async function build(season: number, week: number): Promise<Record<string, CaveSplit>> {
  let raw: { leagueSize?: number; games?: RawGame[] };
  try {
    const base = process.env.CAVEPICKS_FEED_URL ?? CAVEPICKS_URL; // override only for local testing
    const res = await fetch(`${base}/api/cave-splits?week=${week}`, {
      cache: "no-store", // the caching is this function's unstable_cache wrapper
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return {};
    raw = await res.json();
  } catch {
    return {};
  }
  if (!Array.isArray(raw.games) || raw.games.length === 0) return {};

  const [board, aliases] = await Promise.all([getWeekBoard(season, week), cachedOddsNames()]);
  const teamByOddsName = new Map(aliases.map((a) => [a.sourceName, a.teamId]));

  const out: Record<string, CaveSplit> = {};
  for (const r of raw.games) {
    const homeId = teamByOddsName.get(r.home);
    const awayId = teamByOddsName.get(r.away);
    const g = board.find((b) => b.home.id === homeId && b.away.id === awayId);
    if (!g) continue;
    const n = (o: Record<string, number>) => Object.values(o).reduce((s, x) => s + (Number(x) || 0), 0);
    out[g.id] = {
      players: r.players,
      leagueSize: raw.leagueSize ?? 0,
      spread: r.spread,
      total: r.total,
      dog: r.dog,
      picks: n(r.spread) + n(r.total) + n(r.dog),
    };
  }
  return out;
}

/** gameId -> split, for one week. Empty when Cavepicks has nothing locked. */
export const getCaveSplits = unstable_cache(build, ["cave-splits"], {
  revalidate: PIPELINE_TTL,
  tags: ["cave-splits", PIPELINE_TAG],
});
