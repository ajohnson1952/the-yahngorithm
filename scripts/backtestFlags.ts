// ============================================================
// Flag & pick-logic backtest
// ============================================================
// Does betting a flag's implied side beat the closing line?
// Covers the situational flags (recomputed here from schedule +
// point-in-time as-of ratings — thresholds kept in sync with
// scripts/computeFlags.ts), plus line-movement (open→close) and a
// simulation of the current generate-picks spread logic.
//
// Universe: FBS-vs-FBS, 2018-2025, games with an opening AND closing
// consensus line. rlm is NOT here (needs historical Kalshi we don't
// have); "line move" is the closest historical proxy for sharp money.
//
// Run:  npm run backtest-flags
// ============================================================

import { PrismaClient } from "@prisma/client";
import { median } from "../lib/consensus";
import { haversineMiles, tzShift } from "../lib/geo";

const prisma = new PrismaClient();

// --- thresholds (mirror scripts/computeFlags.ts) ---
const HFA = 2.5;
const TRAVEL_MILES = 1200;
const TRAVEL_TZ_HOURS = 2;
const BIG_FAVORITE = 13;
const NEXT_WEEK_COMPETITIVE = 6;
const LOOKAHEAD_MIN_TEAM = 3;
const LOOKAHEAD_MIN_NEXT_OPP = 5;
const CLOSE_RATING_GAP = 3;
const CLEARLY_WEAKER = 10;
const FCS_FLOOR = -35;
const REVENGE_BACK = 2;
const REVENGE_MAX_LOSS = 10;
const REVENGE_WINNABLE = 14;

// --- pick logic (mirror scripts/generatePicks.ts + modelConfig) ---
const SPREAD_EDGE = 2.5;
const LARGE_SPREAD_CAP = 20;

const HURTS = new Set(["short_week", "travel", "lookahead", "letdown"]);
const HELPS = new Set(["off_bye", "revenge"]);

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function record(results: number[]) {
  // results: +1 win, -1 loss, 0 push
  const w = results.filter((r) => r > 0).length;
  const l = results.filter((r) => r < 0).length;
  const p = results.filter((r) => r === 0).length;
  const n = w + l;
  const rate = n ? w / n : 0;
  const se = n ? Math.sqrt((rate * (1 - rate)) / n) : 0;
  return { w, l, p, n, rate, lo: rate - 1.96 * se, hi: rate + 1.96 * se };
}
const fmt = (r: ReturnType<typeof record>) =>
  `${`${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`.padEnd(12)} ${(100 * r.rate).toFixed(1)}% ` +
  `[${(100 * r.lo).toFixed(1)}–${(100 * r.hi).toFixed(1)}]  n=${String(r.n).padStart(4)}` +
  (r.lo > 0.524 ? "  <-- clears break-even" : "");

interface G {
  id: string; season: number; week: number;
  homeTeamId: string; awayTeamId: string;
  kickoff: number; neutral: boolean;
  status: string; hs: number | null; as: number | null;
  vLat: number | null; vLng: number | null;
}

async function main() {
  console.log("Flag & pick-logic backtest\n");

  const [teams, rivalries, games, lines, asof] = await Promise.all([
    prisma.team.findMany({ select: { id: true, classification: true, lat: true, lng: true, timezone: true } }),
    prisma.rivalry.findMany({ select: { teamAId: true, teamBId: true } }),
    prisma.game.findMany({
      where: { season: { gte: 2018 } },
      select: {
        id: true, season: true, week: true, homeTeamId: true, awayTeamId: true,
        kickoffTime: true, neutralSite: true, status: true, homeScore: true, awayScore: true,
        venueLat: true, venueLng: true,
      },
      orderBy: { kickoffTime: "asc" },
    }),
    prisma.line.findMany({
      where: { game: { season: { gte: 2018 } }, market: "spread" },
      select: { gameId: true, lineValue: true, snapshotType: true },
    }),
    prisma.teamRatingAsOf.findMany({ select: { teamId: true, season: true, throughWeek: true, rating: true } }),
  ]);

  const meta = new Map(teams.map((t) => [t.id, t]));
  const isFbs = (id: string) => meta.get(id)?.classification === "fbs";
  const pk = (a: string, b: string) => [a, b].sort().join("|");
  const rivalrySet = new Set(rivalries.map((r) => pk(r.teamAId, r.teamBId)));

  // as-of rating: teamId|season -> throughWeek -> rating
  const asofBy = new Map<string, Map<number, number>>();
  for (const r of asof) {
    const k = `${r.teamId}|${r.season}`;
    (asofBy.get(k) ?? asofBy.set(k, new Map()).get(k)!).set(r.throughWeek, r.rating);
  }
  const ratingOf = (id: string, season: number, beforeWeek: number): number | null => {
    const m = asofBy.get(`${id}|${season}`);
    if (!m) return isFbs(id) ? null : FCS_FLOOR;
    for (let w = Math.max(0, Math.min(beforeWeek, 15)); w >= 0; w--) if (m.has(w)) return m.get(w)!;
    return isFbs(id) ? null : FCS_FLOOR;
  };

  const gm: G[] = games.map((g) => ({
    id: g.id, season: g.season, week: g.week,
    homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
    kickoff: g.kickoffTime.getTime(), neutral: g.neutralSite,
    status: g.status, hs: g.homeScore, as: g.awayScore,
    vLat: g.venueLat, vLng: g.venueLng,
  }));

  // per-team schedule, chronological
  const sched = new Map<string, G[]>();
  for (const g of gm) for (const t of [g.homeTeamId, g.awayTeamId]) (sched.get(t) ?? sched.set(t, []).get(t)!).push(g);

  // consensus lines
  const openBy = new Map<string, number[]>();
  const closeBy = new Map<string, number[]>();
  for (const l of lines) {
    const m = l.snapshotType === "open" ? openBy : l.snapshotType === "close" ? closeBy : null;
    if (m) (m.get(l.gameId) ?? m.set(l.gameId, []).get(l.gameId)!).push(l.lineValue);
  }
  const consensus = (m: Map<string, number[]>, id: string) => {
    const v = m.get(id);
    return v && v.length ? median(v) : null;
  };

  const oppOf = (g: G, t: string) => (t === g.homeTeamId ? g.awayTeamId : g.homeTeamId);
  const isFinal = (g: G) => g.status === "final" && g.hs != null && g.as != null;
  const wonBy = (g: G, t: string) => {
    if (!isFinal(g)) return null;
    return t === g.homeTeamId ? g.hs! - g.as! : g.as! - g.hs!;
  };
  const predMargin = (g: G, t: string): number | null => {
    const rh = ratingOf(g.homeTeamId, g.season, g.week - 1);
    const ra = ratingOf(g.awayTeamId, g.season, g.week - 1);
    if (rh == null || ra == null) return null;
    const hm = rh - ra + (g.neutral ? 0 : HFA);
    return t === g.homeTeamId ? hm : -hm;
  };

  /** flags on team t in game g (mirrors computeFlags.ts) */
  function flagsFor(g: G, t: string): string[] {
    const out: string[] = [];
    const s = sched.get(t) ?? [];
    const prev = [...s].filter((x) => x.season === g.season && x.kickoff < g.kickoff).pop();
    const next = s.find((x) => x.season === g.season && x.kickoff > g.kickoff);
    const tm = meta.get(t)!;

    if (prev) {
      const daysRest = (g.kickoff - prev.kickoff) / 86_400_000;
      if (daysRest < 6) out.push("short_week");
      else if (g.week - prev.week >= 2 && daysRest > 9) out.push("off_bye");
    }

    if (tm.lat != null && tm.lng != null && g.vLat != null && g.vLng != null) {
      const dist = haversineMiles(tm.lat, tm.lng, g.vLat, g.vLng);
      const venueTz = g.neutral ? null : meta.get(g.homeTeamId)?.timezone ?? null;
      const shift = tzShift(tm.timezone, venueTz, new Date(g.kickoff));
      if (dist >= TRAVEL_MILES || Math.abs(shift) >= TRAVEL_TZ_HOURS) out.push("travel");
    }

    // revenge
    const opp = oppOf(g, t);
    const last = [...s]
      .filter((x) => x.season >= g.season - REVENGE_BACK && x.kickoff < g.kickoff && oppOf(x, t) === opp && isFinal(x))
      .pop();
    const thisM = predMargin(g, t);
    if (last && (thisM == null || thisM >= -REVENGE_WINNABLE)) {
      const m = wonBy(last, t)!;
      const wasRiv = rivalrySet.has(pk(t, opp));
      if (m < 0 && (wasRiv || -m <= REVENGE_MAX_LOSS)) out.push("revenge");
    }

    // lookahead
    const mNow = predMargin(g, t);
    const rT = ratingOf(t, g.season, g.week - 1);
    if (mNow != null && mNow >= BIG_FAVORITE && rT != null && rT >= LOOKAHEAD_MIN_TEAM && next) {
      const nOpp = oppOf(next, t);
      const nRiv = rivalrySet.has(pk(t, nOpp));
      const nMargin = predMargin(next, t);
      const nOppR = ratingOf(nOpp, next.season, next.week - 1);
      const stepUp = nMargin != null && nMargin <= NEXT_WEEK_COMPETITIVE && nOppR != null && nOppR >= LOOKAHEAD_MIN_NEXT_OPP;
      if (nRiv || stepUp) out.push("lookahead");
    }

    // letdown
    if (prev && isFinal(prev)) {
      const pm = wonBy(prev, t);
      if (pm != null && pm > 0) {
        const pOpp = oppOf(prev, t);
        const pRiv = rivalrySet.has(pk(t, pOpp));
        const myR = ratingOf(t, g.season, g.week - 1);
        const pOppR = ratingOf(pOpp, prev.season, prev.week - 1);
        const wasUp = pRiv || (myR != null && pOppR != null && pOppR >= myR - CLOSE_RATING_GAP);
        const thisOppR = ratingOf(oppOf(g, t), g.season, g.week - 1);
        const weaker = myR != null && thisOppR != null && thisOppR <= myR - CLEARLY_WEAKER;
        if (wasUp && weaker) out.push("letdown");
      }
    }
    return out;
  }

  // ---- score everything ----
  const flagRes: Record<string, number[]> = {};
  const anyFade: number[] = [];
  const anyHelp: number[] = [];
  const multi2: number[] = []; // >= 2 hurt situational flags on one team
  const multi2BySeason: Record<number, number[]> = {};
  const moveWith: number[] = [];
  const moveFade: number[] = [];
  const pickEdgeOnly: number[] = [];
  const pickCorrob: number[] = [];
  const pickCorrobRefined: number[] = []; // travel/lookahead/letdown/revenge only
  const corrobBy: Record<string, number[]> = {};
  const anyFadeBySeason: Record<number, number[]> = {};
  const corrobBySeason: Record<number, number[]> = {};
  const anyFadeFav: number[] = [];
  const anyFadeDog: number[] = [];

  for (const g of gm) {
    if (g.season < 2021 || !isFinal(g) || !isFbs(g.homeTeamId) || !isFbs(g.awayTeamId)) continue;
    const close = consensus(closeBy, g.id);
    if (close == null) continue;
    const closeHM = -close; // home margin implied by close
    const actualHM = g.hs! - g.as!;
    const coverH = actualHM - closeHM; // + = home covered
    if (Math.abs(coverH) < 1e-9) continue; // treat exact push as skip for rate calc
    const homeCovered = coverH > 0;

    // team-side helper: bet FOR team t → win if t's side covered
    const forTeam = (t: string) => {
      const tHome = t === g.homeTeamId;
      return (tHome && homeCovered) || (!tHome && !homeCovered) ? 1 : -1;
    };

    // flags
    let fadeTeam: string | null = null;
    let helpTeam: string | null = null;
    let multiTeam: string | null = null;
    const HURT_SITU = new Set(["travel", "lookahead", "letdown", "short_week"]);
    for (const t of [g.homeTeamId, g.awayTeamId]) {
      const fs = flagsFor(g, t);
      let hurtCount = 0;
      for (const f of fs) {
        const side = HELPS.has(f) ? forTeam(t) : -forTeam(t); // hurt → bet against
        (flagRes[f] ??= []).push(side);
        if (HELPS.has(f)) helpTeam = t;
        else fadeTeam = t;
        if (HURT_SITU.has(f)) hurtCount++;
      }
      if (hurtCount >= 2) multiTeam = t;
    }
    if (multiTeam) {
      const side = -forTeam(multiTeam);
      multi2.push(side);
      (multi2BySeason[g.season] ??= []).push(side);
    }
    if (fadeTeam) {
      const side = -forTeam(fadeTeam);
      anyFade.push(side);
      (anyFadeBySeason[g.season] ??= []).push(side);
      const fadeIsHome = fadeTeam === g.homeTeamId;
      const fadeIsFav = fadeIsHome ? closeHM > 0 : closeHM < 0;
      (fadeIsFav ? anyFadeFav : anyFadeDog).push(side);
    }
    if (helpTeam) anyHelp.push(forTeam(helpTeam));

    // line movement
    const open = consensus(openBy, g.id);
    if (open != null) {
      const openHM = -open;
      const move = closeHM - openHM; // + = line moved toward home
      if (Math.abs(move) >= 1.0) {
        const towardHome = move > 0;
        const withWin = towardHome === homeCovered ? 1 : -1;
        moveWith.push(withWin);
        moveFade.push(-withWin);
      }
    }

    // simulated picks (spread)
    const rh = ratingOf(g.homeTeamId, g.season, g.week - 1);
    const ra = ratingOf(g.awayTeamId, g.season, g.week - 1);
    if (rh != null && ra != null && Math.abs(close) <= LARGE_SPREAD_CAP) {
      const modelHM = rh - ra + (g.neutral ? 0 : HFA);
      const edge = modelHM - closeHM;
      if (Math.abs(edge) >= SPREAD_EDGE) {
        const backHome = edge > 0;
        const win = backHome === homeCovered ? 1 : -1;
        pickEdgeOnly.push(win);
        // corroboration: a hurt flag on the faded team or a help flag on the backed team
        const backed = backHome ? g.homeTeamId : g.awayTeamId;
        const faded = backHome ? g.awayTeamId : g.homeTeamId;
        const fFaded = flagsFor(g, faded);
        const fBacked = flagsFor(g, backed);
        const corrobFlags = [
          ...fFaded.filter((f) => HURTS.has(f)),
          ...fBacked.filter((f) => HELPS.has(f)),
        ];
        if (corrobFlags.length) {
          pickCorrob.push(win);
          (corrobBySeason[g.season] ??= []).push(win);
          for (const cf of corrobFlags) (corrobBy[cf] ??= []).push(win);
        }
        const REFINED = new Set(["travel", "lookahead", "letdown", "revenge"]);
        if (corrobFlags.some((f) => REFINED.has(f))) pickCorrobRefined.push(win);
      }
    }
  }

  console.log("SITUATIONAL FLAGS — bet the flag's implied side vs the close  (2021-25, break-even 52.4%)\n");
  for (const f of ["off_bye", "revenge", "short_week", "travel", "lookahead", "letdown"]) {
    const r = record(flagRes[f] ?? []);
    const dir = HELPS.has(f) ? "back flagged team" : "fade flagged team";
    console.log(`  ${f.padEnd(11)} (${dir.padEnd(18)}) ${fmt(r)}`);
  }
  console.log(`  ${"ANY fade".padEnd(11)} (${"fade flagged team".padEnd(18)}) ${fmt(record(anyFade))}`);
  console.log(`  ${"ANY help".padEnd(11)} (${"back flagged team".padEnd(18)}) ${fmt(record(anyHelp))}`);
  console.log(`  ${"BAD SPOT".padEnd(11)} (${"≥2 hurt situ flags".padEnd(18)}) ${fmt(record(multi2))}`);
  console.log(`     bad spot by season: ` +
    Object.keys(multi2BySeason).sort().map((s) => {
      const r = record(multi2BySeason[+s]);
      return `${s} ${(100 * r.rate).toFixed(0)}%(${r.n})`;
    }).join("  "));
  console.log(`     ANY fade, flagged team was FAV   ${fmt(record(anyFadeFav))}`);
  console.log(`     ANY fade, flagged team was DOG   ${fmt(record(anyFadeDog))}`);
  console.log(`     ANY fade by season: ` +
    Object.keys(anyFadeBySeason).sort().map((s) => {
      const r = record(anyFadeBySeason[+s]);
      return `${s} ${(100 * r.rate).toFixed(0)}%(${r.n})`;
    }).join("  "));

  console.log("\nLINE MOVEMENT open→close ≥ 1 pt\n");
  console.log(`  follow the move   ${fmt(record(moveWith))}`);
  console.log(`  fade the move     ${fmt(record(moveFade))}`);

  console.log("\nSIMULATED SPREAD PICKS (as-of margin vs close, |edge| ≥ 2.5, spread ≤ 20)\n");
  console.log(`  edge only                    ${fmt(record(pickEdgeOnly))}`);
  console.log(`  + any-flag corroboration      ${fmt(record(pickCorrob))}`);
  console.log(`  + refined corrob (trav/look/  ${fmt(record(pickCorrobRefined))}`);
  console.log(`      letdown/revenge only)`);
  for (const f of Object.keys(corrobBy).sort())
    console.log(`     corrob by ${f.padEnd(11)} ${fmt(record(corrobBy[f]))}`);
  console.log(`     corrob picks by season: ` +
    Object.keys(corrobBySeason).sort().map((s) => {
      const r = record(corrobBySeason[+s]);
      return `${s} ${(100 * r.rate).toFixed(0)}%(${r.n})`;
    }).join("  "));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
