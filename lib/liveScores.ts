// ============================================================
// Live scores — ESPN's public scoreboard JSON
// ============================================================
// The watch guide re-ranks the quadbox on live game state (a one-score
// game in the 4th jumps the board; a blowout sinks to the bench). We
// deliberately keep live scores OUT of our database and our pipeline —
// this is a read, on demand, when someone loads or refreshes /watch.
//
// ESPN's site API is the unauthenticated JSON that powers their own
// scoreboard widgets — no key, best-effort, generous. Every failure here
// is swallowed: a bad response just means /watch falls back to the
// pregame numbers it already had.
// ============================================================

import { normalize } from "./nameMatching";

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

export type LiveState = "pre" | "in" | "post";

export interface LiveGame {
  state: LiveState;
  homeScore: number | null;
  awayScore: number | null;
  period: number; // 0 pregame, 1-4 regulation, 5+ overtime
  clock: string; // "12:34"; "0:00" between periods
  detail: string; // ESPN's shortDetail — "2:14 - 4th", "Halftime", "Final"
}

interface EspnCompetitor {
  homeAway?: "home" | "away";
  score?: string;
  team?: {
    location?: string;
    name?: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
  };
}
interface EspnEvent {
  competitions?: {
    competitors?: EspnCompetitor[];
    status?: {
      displayClock?: string;
      period?: number;
      type?: { state?: string; shortDetail?: string; completed?: boolean };
    };
  }[];
}

interface ParsedEvent {
  homeWords: string[];
  awayWords: string[];
  live: LiveGame;
}

/** en-CA date key ("2026-09-06") -> ESPN's dates param ("20260906") */
const espnDate = (ymd: string) => ymd.replace(/-/g, "");

async function fetchDay(ymd: string): Promise<EspnEvent[]> {
  try {
    const res = await fetch(`${ESPN_SCOREBOARD}?dates=${espnDate(ymd)}&limit=400`, {
      // a short shared cache so a burst of people hitting "refresh" doesn't
      // hammer ESPN — still live to the eye
      next: { revalidate: 15 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { events?: EspnEvent[] };
    return json.events ?? [];
  } catch {
    return [];
  }
}

/** ESPN's cleanest school name for matching — "location" ("Louisiana Tech"),
 *  falling back through the other name fields. */
function espnName(t: EspnCompetitor["team"]): string {
  return t?.location ?? t?.shortDisplayName ?? t?.displayName ?? t?.name ?? "";
}

function parseEvent(ev: EspnEvent): ParsedEvent | null {
  const comp = ev.competitions?.[0];
  const cs = comp?.competitors ?? [];
  const home = cs.find((c) => c.homeAway === "home");
  const away = cs.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const st = comp?.status?.type?.state;
  const state: LiveState = st === "in" ? "in" : st === "post" ? "post" : "pre";
  const num = (s?: string) => (s != null && s !== "" && !Number.isNaN(Number(s)) ? Number(s) : null);

  return {
    homeWords: normalize(espnName(home.team)),
    awayWords: normalize(espnName(away.team)),
    live: {
      state,
      homeScore: num(home.score),
      awayScore: num(away.score),
      period: comp?.status?.period ?? 0,
      clock: comp?.status?.displayClock ?? "",
      detail: comp?.status?.type?.shortDetail ?? "",
    },
  };
}

/** One normalized name list matches another when the shorter is fully
 *  contained in the longer ("louisiana" ⊂ "louisiana tech"). That's loose on
 *  its own, but matchLiveScores only accepts an event when BOTH teams match,
 *  which kills the ambiguity across a single day's ~60-game slate. */
function wordsMatch(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((w) => long.includes(w));
}
/** exact set match scores higher than a loose containment match */
const matchStrength = (a: string[], b: string[]) =>
  a.length === b.length && a.every((w, i) => b[i] === w) ? 2 : 1;

/** Match our games to ESPN events by team name, within one day's slate.
 *  Returns live state keyed by OUR game id, with scores oriented to our
 *  home/away (ESPN can flip them at neutral sites). */
export function matchLiveScores(
  games: {
    id: string;
    home: { name: string };
    away: { name: string };
  }[],
  events: EspnEvent[]
): Map<string, LiveGame> {
  const parsed = events
    .map(parseEvent)
    .filter((x): x is ParsedEvent => x != null);
  const out = new Map<string, LiveGame>();
  const used = new Set<number>();

  for (const g of games) {
    const gh = normalize(g.home.name);
    const ga = normalize(g.away.name);
    let bestIdx = -1;
    let bestScore = 0;

    parsed.forEach((p, i) => {
      if (used.has(i)) return;
      const straight = wordsMatch(gh, p.homeWords) && wordsMatch(ga, p.awayWords);
      const flipped = wordsMatch(gh, p.awayWords) && wordsMatch(ga, p.homeWords);
      if (!straight && !flipped) return;
      const s = straight
        ? matchStrength(gh, p.homeWords) + matchStrength(ga, p.awayWords)
        : matchStrength(gh, p.awayWords) + matchStrength(ga, p.homeWords);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    });

    if (bestIdx < 0) continue;
    used.add(bestIdx);
    const p = parsed[bestIdx];
    const straight = wordsMatch(gh, p.homeWords) && wordsMatch(ga, p.awayWords);
    out.set(
      g.id,
      straight
        ? p.live
        : { ...p.live, homeScore: p.live.awayScore, awayScore: p.live.homeScore }
    );
  }
  return out;
}

/** Live state for a day's games, keyed by our game id. `ymd` is an en-CA
 *  date key (America/Chicago). Empty map on any failure. */
export async function getLiveScores(
  games: { id: string; home: { name: string }; away: { name: string } }[],
  ymd: string
): Promise<Map<string, LiveGame>> {
  if (games.length === 0) return new Map();
  const events = await fetchDay(ymd);
  return matchLiveScores(games, events);
}
