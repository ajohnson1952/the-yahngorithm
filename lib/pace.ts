// ============================================================
// Team pace (possessions per game) — an input to the totals model
// ============================================================
// CFBD's advanced season stats give total offensive drives; games
// played comes from our own Game table. Early in a season a team
// has little/no current data, so we blend toward the prior season
// and fall back to the league average.
// ============================================================

import { cfbdGet } from "./cfbd";

/** Drives per team per game, league-wide (2025 baseline). ~23 total/game. */
export const LEAGUE_AVG_POSSESSIONS = 11.5;

/** Weeks of current-season data before we fully trust it over the prior year. */
const RAMP_GAMES = 5;

interface AdvRow {
  team: string;
  offense?: { drives?: number | null } | null;
}
interface RecordRow {
  team: string;
  total?: { games?: number | null } | null;
}

async function gamesPlayedByTeam(season: number): Promise<Map<string, number>> {
  // CFBD /records covers the same span (incl. postseason) as the advanced stats,
  // so drives/games line up. Our own Game table is regular-season-only.
  const recs = await cfbdGet<RecordRow[]>(`/records?year=${season}`).catch(
    () => [] as RecordRow[]
  );
  const m = new Map<string, number>();
  for (const r of recs) {
    if (r.total?.games != null) m.set(r.team, r.total.games);
  }
  return m;
}

const drivesPerGame = (adv: AdvRow[], games: Map<string, number>) => {
  const m = new Map<string, number>();
  for (const r of adv) {
    const d = r.offense?.drives;
    const g = games.get(r.team) ?? 0;
    if (d != null && g > 0) m.set(r.team, d / g);
  }
  return m;
};

/**
 * possessions/game keyed by CFBD team name. Blends current season (as games
 * accrue) with the prior season; league average when we have neither.
 */
export async function paceByTeamName(
  season: number
): Promise<Map<string, number>> {
  const [curAdv, priorAdv, curGames, priorGames] = await Promise.all([
    cfbdGet<AdvRow[]>(`/stats/season/advanced?year=${season}`).catch(() => [] as AdvRow[]),
    cfbdGet<AdvRow[]>(`/stats/season/advanced?year=${season - 1}`).catch(() => [] as AdvRow[]),
    gamesPlayedByTeam(season),
    gamesPlayedByTeam(season - 1),
  ]);

  const curPace = drivesPerGame(curAdv, curGames);
  const priorPace = drivesPerGame(priorAdv, priorGames);

  const names = new Set<string>([...curPace.keys(), ...priorPace.keys()]);
  const out = new Map<string, number>();
  for (const name of names) {
    const cur = curPace.get(name);
    const prior = priorPace.get(name);
    const gp = curGames.get(name) ?? 0;
    let pace: number;
    if (cur != null && prior != null) {
      const w = Math.min(gp, RAMP_GAMES) / RAMP_GAMES;
      pace = w * cur + (1 - w) * prior;
    } else {
      pace = cur ?? prior ?? LEAGUE_AVG_POSSESSIONS;
    }
    out.set(name, pace);
  }
  return out;
}
