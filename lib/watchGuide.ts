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
import type { GameView, TeamLite, FlagView } from "./webData";
import type { LiveGame } from "./liveScores";

// ---------- scoring ----------
// Weights sum to 1, plus a small additive chaos bonus (situational flags) on
// top — capped so it nudges borderline games, never dominates. Tune here,
// not scattered through the formula.
const W_CLOSE = 0.4; // projected competitiveness
const W_PACE = 0.15; // projected scoring
const W_QUALITY = 0.3; // ranked-team stakes
const W_RIVALRY = 0.15; // rivalry atmosphere

const NO_MODEL_CAP = 15; // FBS-vs-FCS ceiling — almost always a blowout
const BLOWOUT_MARGIN = 24; // |spread| past this gets called out as likely lopsided

// A team flagged for one of these plays worse than its number more often than
// not — i.e. real upset potential, which is its own kind of watchable even
// when the market says blowout.
function chaosBonus(flags: FlagView[]): { bonus: number; reason: string | null } {
  const types = new Set(flags.map((f) => f.flagType));
  if (types.has("bad_spot")) return { bonus: 10, reason: "trap game — upset watch" };
  if (types.has("lookahead") || types.has("letdown"))
    return { bonus: 5, reason: "lookahead/letdown spot — upset watch" };
  if (types.has("revenge")) return { bonus: 3, reason: "revenge spot" };
  return { bonus: 0, reason: null };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------- live re-ranking ----------
// Once a game is actually being played, the score on the field trumps the
// pregame projection. A one-score game late is the best thing on TV; a
// blowout is the worst, no matter how good the matchup looked. These
// deltas are additive on the 0-100 base and lean hard late (`late` ramps
// 0 -> 1 across regulation), so early wobble barely moves the board.

const QUARTERS = ["1st", "2nd", "3rd", "4th"];

/** Human clock label: "2:14 4th", "end 3rd", "halftime", "OT". */
export function liveClockLabel(live: LiveGame): string {
  if (/halftime/i.test(live.detail)) return "halftime";
  if (live.period >= 5) return live.period === 5 ? "OT" : `${live.period - 3}OT`;
  if (live.period >= 1 && live.period <= 4) {
    const q = QUARTERS[live.period - 1];
    return live.clock && live.clock !== "0:00" ? `${live.clock} ${q}` : `end ${q}`;
  }
  return live.detail || "live";
}

/** Fraction of regulation elapsed, 0-1 (overtime -> 1). */
function gameFrac(live: LiveGame): number {
  if (live.period >= 5) return 1;
  if (live.period < 1) return 0;
  const [m, s] = (live.clock || "15:00").split(":").map(Number);
  const leftInQ =
    (Number.isFinite(m) ? m : 15) + (Number.isFinite(s) ? s : 0) / 60;
  const elapsed = (Math.min(live.period, 4) - 1) * 15 + (15 - clamp(leftInQ, 0, 15));
  return clamp(elapsed / 60, 0, 1);
}

function liveDelta(live: LiveGame): { delta: number; reason: string } {
  const as = live.awayScore ?? 0;
  const hs = live.homeScore ?? 0;
  const box = `${as}–${hs}`; // away–home, scoreboard order

  if (live.state === "post") return { delta: -70, reason: `final · ${box}` };

  const margin = Math.abs(hs - as);
  const frac = gameFrac(live);
  const late = clamp(frac, 0, 1);
  const clk = liveClockLabel(live);

  let delta: number;
  let reason: string;
  if (live.period >= 5) {
    delta = 36;
    reason = `overtime — ${box}`;
  } else if (margin <= 8) {
    delta = 12 + 24 * late;
    reason = `one-score game (${box}) · ${clk}`;
  } else if (margin <= 16) {
    delta = 2 + 5 * late;
    reason = `within two scores (${box}) · ${clk}`;
  } else if (margin <= 24) {
    delta = -(6 + 12 * late);
    reason = `pulling away (${box}) · ${clk}`;
  } else {
    delta = -(16 + 30 * late);
    reason = `blowout (${box}) · ${clk}`;
  }
  if (frac < 0.25) delta *= 0.45; // 1st quarter — the score hasn't said much yet
  return { delta: Math.round(delta), reason };
}

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
  predictedPossessions: number | null;
  hasModel: boolean;
  rivalry: string | null;
  flags: FlagView[];
  live: LiveGame | null;
  score: number; // 0-100 watchability
  reasons: string[];
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

function scoreGame(
  g: GameView,
  rivalryName: string | null,
  live: LiveGame | null
): { score: number; reasons: string[] } {
  const marginSrc = g.marketSpread ?? g.modelSpreadSp;
  const margin = marginSrc == null ? null : Math.abs(marginSrc);
  const totalSrc = g.marketTotal ?? g.modelTotal ?? null;

  const cScore = closenessScore(margin);
  const pScore = paceScore(totalSrc);
  const qScore = qualityScore(g.home.apRank, g.away.apRank);
  const rScore = rivalryName ? 100 : 0;

  let score = cScore * W_CLOSE + pScore * W_PACE + qScore * W_QUALITY + rScore * W_RIVALRY;

  const lv = live && live.state !== "pre" ? liveDelta(live) : null;
  // a game that's over is just a score to glance at — drop the pregame pitch
  if (lv && live!.state === "post") {
    return { score: Math.round(clamp(score + lv.delta, 0, 100)), reasons: [lv.reason] };
  }

  const reasons: string[] = [];
  if (!g.hasModel) {
    score = Math.min(score, NO_MODEL_CAP);
    if (lv) {
      score += lv.delta;
      reasons.push(lv.reason);
    } else {
      reasons.push("FBS vs. lower division — likely lopsided");
    }
    return { score: Math.round(clamp(score, 0, 100)), reasons };
  }
  const { bonus, reason: chaosReason } = chaosBonus(g.flags);
  score += bonus;

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
  if (chaosReason) reasons.push(chaosReason);
  if (margin != null && margin >= BLOWOUT_MARGIN) reasons.push(`likely blowout (${r1(margin)}-pt line)`);
  if (reasons.length === 0) reasons.push("nothing standing out — a default watch");

  // live status leads the reason list once the ball's in the air
  if (lv) {
    score += lv.delta;
    reasons.unshift(lv.reason);
  }

  return { score: Math.round(clamp(score, 0, 100)), reasons };
}

export function toWatchGame(
  g: GameView,
  rivalryMap: Map<string, string>,
  live: LiveGame | null = null
): WatchGame {
  const rivalry = rivalryMap.get(pairKey(g.home.id, g.away.id)) ?? null;
  const { score, reasons } = scoreGame(g, rivalry, live);
  // the field overrides the schedule: show the live score and status
  const liveOn = live != null && live.state !== "pre";
  return {
    id: g.id,
    kickoff: g.kickoff,
    status: liveOn ? (live!.state === "in" ? "in" : "final") : g.status,
    home: g.home,
    away: g.away,
    homeScore: liveOn ? live!.homeScore : g.homeScore,
    awayScore: liveOn ? live!.awayScore : g.awayScore,
    broadcast: g.broadcast,
    venue: g.venue,
    neutralSite: g.neutralSite,
    marketSpread: g.marketSpread,
    marketTotal: g.marketTotal,
    predictedPossessions: g.predictedPossessions,
    hasModel: g.hasModel,
    rivalry,
    flags: g.flags,
    live: live ?? null,
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
export function buildWatchWindows(games: WatchGame[], now = Date.now()): WatchWindow[] {
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
    // for the current / upcoming windows, trust ESPN over the duration
    // estimate: an in-progress game counts even if it's run long; a
    // just-finished one still shows (it sinks to the bench on score) but
    // one that ended hours ago doesn't clutter the board.
    const current = winEnd > now;
    const live = games.filter((g) => {
      const k = Date.parse(g.kickoff);
      const overlaps = k < winEnd && k + GAME_DURATION_MS > winStart;
      if (current && g.live?.state === "in") return true;
      return overlaps;
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
