// ============================================================
// Watch guide — "what should be on the quadbox right now"
// ============================================================
// Turns a day's board into a schedule of viewing windows. Each window is a
// stretch of time where the same 4 games are the best available (by a
// watchability score), assuming a fixed quadbox capacity and a fixed
// estimated game length — nobody knows real end times in advance, so this is
// a planning tool, not a live re-optimizer.
//
// Pure, cheap computation over data getWeekBoard() already fetched and
// cached — no new DB load beyond the tiny, rarely-changing rivalry table.
// ============================================================

import { unstable_cache } from "next/cache";
import { db } from "./db";
import type { GameView, TeamLite } from "./webData";

// ---------- scoring ----------
// Weights sum to 1. Tune here, not scattered through the formula.
const W_CLOSE = 0.4; // projected competitiveness
const W_PACE = 0.15; // projected scoring
const W_QUALITY = 0.3; // ranked-team stakes
const W_RIVALRY = 0.15; // rivalry atmosphere

const NO_MODEL_CAP = 15; // FBS-vs-FCS ceiling — almost always a blowout
const BLOWOUT_MARGIN = 24; // |spread| past this gets called out as likely lopsided

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

function closenessScore(marginAbs: number | null): number {
  if (marginAbs == null) return 40; // no line at all — mild, not a bonus
  return clamp(100 - marginAbs * 3.4, 0, 100); // 0 pts -> 100, ~29 pt swing -> 0
}
function paceScore(total: number | null): number {
  if (total == null) return 50;
  return clamp(((total - 38) / (72 - 38)) * 100, 0, 100);
}
function qualityScore(homeRank: number | null, awayRank: number | null): number {
  const best = Math.min(homeRank ?? 99, awayRank ?? 99);
  if (best > 25) return 0;
  const base = clamp(100 - (best - 1) * 4, 0, 100); // #1 -> 100 ... #25 -> 4
  return homeRank != null && awayRank != null ? Math.min(100, base + 20) : base;
}

export interface WatchGame {
  id: string;
  kickoff: string;
  status: string;
  home: TeamLite;
  away: TeamLite;
  homeScore: number | null;
  awayScore: number | null;
  broadcast: string | null;
  venue: string | null;
  neutralSite: boolean;
  marketSpread: number | null;
  marketTotal: number | null;
  hasModel: boolean;
  rivalry: string | null;
  score: number; // 0-100 watchability
  reasons: string[];
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

function scoreGame(g: GameView, rivalryName: string | null): { score: number; reasons: string[] } {
  const marginSrc = g.marketSpread ?? g.modelSpreadSp;
  const margin = marginSrc == null ? null : Math.abs(marginSrc);
  const totalSrc = g.marketTotal ?? g.modelTotal ?? null;

  const cScore = closenessScore(margin);
  const pScore = paceScore(totalSrc);
  const qScore = qualityScore(g.home.apRank, g.away.apRank);
  const rScore = rivalryName ? 100 : 0;

  let score = cScore * W_CLOSE + pScore * W_PACE + qScore * W_QUALITY + rScore * W_RIVALRY;

  const reasons: string[] = [];
  if (!g.hasModel) {
    score = Math.min(score, NO_MODEL_CAP);
    return { score: Math.round(clamp(score, 0, 100)), reasons: ["FBS vs. lower division — likely lopsided"] };
  }
  if (margin != null && margin <= 3) reasons.push(`toss-up (${r1(margin)}-pt line)`);
  else if (margin != null && margin <= 7) reasons.push(`close game (${r1(margin)}-pt line)`);
  if (totalSrc != null && totalSrc >= 62) reasons.push(`shootout pace (${r1(totalSrc)} total)`);
  if (qScore >= 40) {
    const parts: string[] = [];
    if (g.home.apRank) parts.push(`#${g.home.apRank} ${g.home.abbr ?? g.home.name}`);
    if (g.away.apRank) parts.push(`#${g.away.apRank} ${g.away.abbr ?? g.away.name}`);
    reasons.push(parts.join(" vs. "));
  }
  if (rivalryName) reasons.push(rivalryName);
  if (margin != null && margin >= BLOWOUT_MARGIN) reasons.push(`likely blowout (${r1(margin)}-pt line)`);
  if (reasons.length === 0) reasons.push("nothing standing out — a default watch");

  return { score: Math.round(clamp(score, 0, 100)), reasons };
}

export function toWatchGame(g: GameView, rivalryMap: Map<string, string>): WatchGame {
  const rivalry = rivalryMap.get(pairKey(g.home.id, g.away.id)) ?? null;
  const { score, reasons } = scoreGame(g, rivalry);
  return {
    id: g.id,
    kickoff: g.kickoff,
    status: g.status,
    home: g.home,
    away: g.away,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    broadcast: g.broadcast,
    venue: g.venue,
    neutralSite: g.neutralSite,
    marketSpread: g.marketSpread,
    marketTotal: g.marketTotal,
    hasModel: g.hasModel,
    rivalry,
    score,
    reasons,
  };
}

// ---------- windowing ----------

const GAME_DURATION_MS = 3.67 * 3_600_000; // ~3h40m — CFB's average broadcast length
const CLUSTER_GAP_MS = 45 * 60_000; // kickoffs this close together share a window
export const QUADBOX_SIZE = 4;

export interface WatchWindow {
  start: string; // ISO
  lineup: WatchGame[];
  bench: WatchGame[];
  added: WatchGame[]; // vs the previous window
  dropped: WatchGame[];
}

/** Turn a day's games into a schedule of quadbox windows. A window starts at
 *  each distinct kickoff wave (kickoffs within CLUSTER_GAP_MS share one) and
 *  runs until the next wave. "Live during a window" uses the fixed estimated
 *  game length, so this is an estimate — real games run long or short. */
export function buildWatchWindows(games: WatchGame[]): WatchWindow[] {
  const kicks = [...new Set(games.map((g) => Date.parse(g.kickoff)))].sort((a, b) => a - b);
  const starts: number[] = [];
  for (const k of kicks) {
    const last = starts[starts.length - 1];
    if (last == null || k - last > CLUSTER_GAP_MS) starts.push(k);
  }

  const windows: WatchWindow[] = [];
  let prevLineup: WatchGame[] = [];
  for (let i = 0; i < starts.length; i++) {
    const winStart = starts[i];
    const winEnd = starts[i + 1] ?? winStart + GAME_DURATION_MS;
    const live = games.filter((g) => {
      const k = Date.parse(g.kickoff);
      return k < winEnd && k + GAME_DURATION_MS > winStart;
    });
    if (live.length === 0) continue;

    const ranked = [...live].sort((a, b) => b.score - a.score);
    const lineup = ranked.slice(0, QUADBOX_SIZE);

    // a new game becoming live (or an old one dropping out of range) doesn't
    // always change who's actually in the top 4 — only start a new window
    // when the lineup itself changes, so the schedule doesn't churn on
    // every kickoff.
    const sameAsBefore =
      windows.length > 0 &&
      lineup.length === prevLineup.length &&
      lineup.every((g) => prevLineup.some((p) => p.id === g.id));
    if (sameAsBefore) continue;

    const bench = ranked.slice(QUADBOX_SIZE, QUADBOX_SIZE + 6);
    const added = lineup.filter((g) => !prevLineup.some((p) => p.id === g.id));
    const dropped = prevLineup.filter((g) => !lineup.some((l) => l.id === g.id));

    windows.push({ start: new Date(winStart).toISOString(), lineup, bench, added, dropped });
    prevLineup = lineup;
  }
  return windows;
}

// ---------- rivalry lookup (tiny, cached — rarely changes) ----------

export const getRivalryPairs = unstable_cache(
  async () => {
    const rows = await db.rivalry.findMany({
      select: { teamAId: true, teamBId: true, name: true },
    });
    return rows.map((r) => ({ key: pairKey(r.teamAId, r.teamBId), name: r.name }));
  },
  ["rivalry-pairs"],
  { revalidate: 3600, tags: ["rivalry-pairs"] }
);
