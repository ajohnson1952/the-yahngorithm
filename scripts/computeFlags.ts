// ============================================================
// Situational flags  (PROJECT_BRIEF build step: situational flags)
// ============================================================
// Derives GameFlag rows from schedule + ratings + rivalries. These
// are corroborating signals for the spread model, never the primary
// prediction. Thresholds are deliberately conservative.
//
//   short_week  < 6 days since the team's previous game
//   off_bye     > 10 days since previous game (season openers skipped)
//   travel      >= 1200 mi home->venue, OR >= 2 hr body-clock shift
//   revenge     team LOST the most recent prior meeting with this opp
//   lookahead   favored by >= 10 now, AND next week's opp is a rivalry
//               or rated within 3 SP+ pts (or better)
//   letdown     won an "up" game last week (rivalry, or opp within 3
//               SP+ pts), AND this week's opp is >= 10 SP+ pts weaker
//
// Flags are fully derived — the script WIPES and recomputes for the
// target week(s). No API calls.
//
// Run:  npm run compute-flags
//       npm run compute-flags -- --season 2026 --week 3
//       npm run compute-flags -- --all
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { HOME_FIELD_ADVANTAGE } from "../lib/modelConfig";
import { haversineMiles, tzShift } from "../lib/geo";

const prisma = new PrismaClient();

const TRAVEL_MILES = 1200;
const TRAVEL_TZ_HOURS = 2;
const BIG_FAVORITE = 13; // predicted margin this week for lookahead
const NEXT_WEEK_COMPETITIVE = 6; // lookahead — next game predicted within this many pts
const LOOKAHEAD_MIN_TEAM = 3; // lookahead only applies to at-least-decent teams
const LOOKAHEAD_MIN_NEXT_OPP = 5; // ...facing an at-least-decent team next (unless rivalry)
const CLOSE_RATING_GAP = 3; // "an up game" — opp within this many SP+ pts
const CLEARLY_WEAKER = 10; // letdown — this week's opp this many SP+ pts worse
const FCS_RATING_FLOOR = -35; // stand-in SP+ for unrated (FCS) opponents
const REVENGE_MAX_SEASONS_BACK = 2; // only a recent loss counts
const REVENGE_MAX_LOSS = 10; // ...and a close one (unless it was a rivalry)
const REVENGE_WINNABLE = 14; // ...and this week's game is within reach

type FlagType =
  | "short_week"
  | "off_bye"
  | "travel"
  | "revenge"
  | "lookahead"
  | "letdown";

function parseArgs(): { season?: number; week?: number; all: boolean } {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const season = val("--season");
  const week = val("--week");
  const all = args.includes("--all");
  if (!all && ((season && !week) || (!season && week))) {
    console.error("Pass --season AND --week together, --all, or neither. Stopping.");
    process.exit(1);
  }
  return {
    season: season ? Number(season) : undefined,
    week: week ? Number(week) : undefined,
    all,
  };
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const r1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const { season: sArg, week: wArg, all } = parseArgs();
  const current = await getCurrentSeasonWeek();
  const season = sArg ?? current.season;
  const targetWeeks = all ? null : [wArg ?? current.week];

  console.log(
    all
      ? `Computing flags for the FULL ${season} season\n`
      : `Computing flags for season ${season}, week ${targetWeeks![0]}\n`
  );

  // --- load everything ---
  // Games from the target season AND all earlier ones — the earlier games are
  // schedule context (the 'revenge' flag needs prior meetings). Flags are only
  // computed for the target season/weeks (gamesInScope, below).
  const [games, ratings, rivalries, fbsTeams] = await Promise.all([
    prisma.game.findMany({
      where: { season: { lte: season } },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoffTime: "asc" },
    }),
    prisma.teamRatingWeekly.findMany({
      where: { season },
      select: { teamId: true, week: true, spPlusOverall: true },
    }),
    prisma.rivalry.findMany({ select: { teamAId: true, teamBId: true } }),
    prisma.team.findMany({
      where: { classification: "fbs" },
      select: { id: true },
    }),
  ]);

  const fbs = new Set(fbsTeams.map((t) => t.id));
  const rivalrySet = new Set(rivalries.map((r) => pairKey(r.teamAId, r.teamBId)));

  // latest known SP+ per team (ratings barely move week to week, so the most
  // recent snapshot is a fine stand-in for "how good is this team").
  const spByTeam = new Map<string, number>();
  for (const r of [...ratings].sort((a, b) => a.week - b.week)) {
    if (r.spPlusOverall != null) spByTeam.set(r.teamId, r.spPlusOverall);
  }
  const rating = (teamId: string) =>
    spByTeam.get(teamId) ?? (fbs.has(teamId) ? null : FCS_RATING_FLOOR);

  // each team's games in kickoff order
  const byTeam = new Map<string, typeof games>();
  for (const g of games) {
    for (const tid of [g.homeTeamId, g.awayTeamId]) {
      const arr = byTeam.get(tid);
      if (arr) arr.push(g);
      else byTeam.set(tid, [g]);
    }
  }

  type G = (typeof games)[number];
  const opponentOf = (g: G, teamId: string) =>
    teamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
  const isFinal = (g: G) =>
    g.status === "final" && g.homeScore != null && g.awayScore != null;
  const wonBy = (g: G, teamId: string) => {
    if (!isFinal(g)) return null;
    const my = teamId === g.homeTeamId ? g.homeScore! : g.awayScore!;
    const opp = teamId === g.homeTeamId ? g.awayScore! : g.homeScore!;
    return my - opp;
  };

  /** predicted margin for `teamId` in game g, from SP+ (null if either unrated). */
  const predictedMargin = (g: G, teamId: string): number | null => {
    const hs = rating(g.homeTeamId);
    const as = rating(g.awayTeamId);
    if (hs == null || as == null) return null;
    const hfa = g.neutralSite ? 0 : HOME_FIELD_ADVANTAGE;
    const homeMargin = hs - as + hfa;
    return teamId === g.homeTeamId ? homeMargin : -homeMargin;
  };

  const gamesInScope = games.filter(
    (g) =>
      g.season === season &&
      (targetWeeks == null || targetWeeks.includes(g.week))
  );

  const rows: Prisma.GameFlagCreateManyInput[] = [];
  const counts: Record<FlagType, number> = {
    short_week: 0,
    off_bye: 0,
    travel: 0,
    revenge: 0,
    lookahead: 0,
    letdown: 0,
  };
  const examples: Record<FlagType, string[]> = {
    short_week: [],
    off_bye: [],
    travel: [],
    revenge: [],
    lookahead: [],
    letdown: [],
  };

  const add = (
    g: G,
    teamId: string,
    flagType: FlagType,
    detail: Prisma.InputJsonValue,
    example: string
  ) => {
    rows.push({ gameId: g.id, teamId, flagType, detail });
    counts[flagType]++;
    if (examples[flagType].length < 4) examples[flagType].push(example);
  };

  for (const g of gamesInScope) {
    for (const teamId of [g.homeTeamId, g.awayTeamId]) {
      if (!fbs.has(teamId)) continue; // only analyze FBS teams
      const sched = byTeam.get(teamId) ?? [];
      const kickoff = g.kickoffTime.getTime();
      const teamName =
        teamId === g.homeTeamId
          ? g.homeTeam.canonicalName
          : g.awayTeam.canonicalName;
      const oppName =
        teamId === g.homeTeamId
          ? g.awayTeam.canonicalName
          : g.homeTeam.canonicalName;
      const label = `wk${g.week} ${teamName} (vs ${oppName})`;

      // schedule-spot flags only look within the same season; revenge looks
      // across all seasons (see below).
      const prev = [...sched]
        .filter((x) => x.season === g.season && x.kickoffTime.getTime() < kickoff)
        .pop();
      const next = sched.find(
        (x) => x.season === g.season && x.kickoffTime.getTime() > kickoff
      );

      // --- short_week / off_bye ---
      if (prev) {
        const daysRest = (kickoff - prev.kickoffTime.getTime()) / 86_400_000;
        const skippedAWeek = g.week - prev.week >= 2;
        if (daysRest < 6) {
          add(g, teamId, "short_week", { daysRest: r1(daysRest) },
            `${label}: ${r1(daysRest)}d rest`);
        } else if (skippedAWeek && daysRest > 9) {
          // a real bye = a missing week number, not just a long calendar gap
          // (week 1 spans ~10 days, which would otherwise look like a bye)
          add(g, teamId, "off_bye", { daysRest: r1(daysRest) },
            `${label}: ${r1(daysRest)}d rest`);
        }
      }

      // --- travel (each team's own home -> this venue) ---
      const home =
        teamId === g.homeTeamId ? g.homeTeam : g.awayTeam;
      if (
        home.lat != null &&
        home.lng != null &&
        g.venueLat != null &&
        g.venueLng != null
      ) {
        const dist = haversineMiles(home.lat, home.lng, g.venueLat, g.venueLng);
        const venueTz = g.neutralSite ? null : g.homeTeam.timezone;
        const shift = tzShift(home.timezone, venueTz, g.kickoffTime);
        if (dist >= TRAVEL_MILES || Math.abs(shift) >= TRAVEL_TZ_HOURS) {
          add(g, teamId, "travel",
            { distanceMiles: Math.round(dist), tzChange: r1(shift) },
            `${label}: ${Math.round(dist)}mi, ${r1(shift)}h`);
        }
      }

      // --- revenge (lost the last time these two met) ---
      // Every rematch has a loser, so a bare "lost last time" fires on ~half
      // of all conference games — useless as a signal. The version handicappers
      // actually mean: a RECENT loss that stung — a rivalry loss, or a close
      // one they let slip. A blowout loss to a better team isn't revenge.
      const opp = opponentOf(g, teamId);
      const lastMeeting = [...sched]
        .filter(
          (x) =>
            x.season >= g.season - REVENGE_MAX_SEASONS_BACK &&
            x.kickoffTime.getTime() < kickoff &&
            opponentOf(x, teamId) === opp &&
            isFinal(x)
        )
        .pop();
      // and it only matters if THIS week's game is close enough that motivation
      // could plausibly swing it.
      const thisMargin = predictedMargin(g, teamId);
      const winnableNow = thisMargin == null || thisMargin >= -REVENGE_WINNABLE;
      if (lastMeeting && winnableNow) {
        const margin = wonBy(lastMeeting, teamId)!;
        const wasRivalry = rivalrySet.has(pairKey(teamId, opp));
        if (margin < 0 && (wasRivalry || -margin <= REVENGE_MAX_LOSS)) {
          add(g, teamId, "revenge",
            {
              lastMeeting: lastMeeting.kickoffTime.toISOString().slice(0, 10),
              lostBy: -margin,
              wasRivalry,
            },
            `${label}: lost last meeting by ${-margin}${wasRivalry ? " (rivalry)" : ""}`);
        }
      }

      // --- lookahead (big favorite now, trap game next week) ---
      const marginNow = predictedMargin(g, teamId);
      const teamR = rating(teamId);
      if (
        marginNow != null &&
        marginNow >= BIG_FAVORITE &&
        teamR != null &&
        teamR >= LOOKAHEAD_MIN_TEAM &&
        next
      ) {
        const nextOpp = opponentOf(next, teamId);
        const nextIsRivalry = rivalrySet.has(pairKey(teamId, nextOpp));
        // "much tougher next week" = next game projected close (or a loss)
        // AGAINST a real team — not merely "opponent isn't much worse", and
        // not a bad team that just loses to everyone good.
        const nextMargin = predictedMargin(next, teamId);
        const nextOppR = rating(nextOpp);
        const nextIsStepUp =
          nextMargin != null &&
          nextMargin <= NEXT_WEEK_COMPETITIVE &&
          nextOppR != null &&
          nextOppR >= LOOKAHEAD_MIN_NEXT_OPP;
        if (nextIsRivalry || nextIsStepUp) {
          const nextOppName =
            nextOpp === next.homeTeamId
              ? next.homeTeam.canonicalName
              : next.awayTeam.canonicalName;
          add(g, teamId, "lookahead",
            {
              marginThisWeek: r1(marginNow),
              nextOpponent: nextOppName,
              nextGameMargin: nextMargin == null ? null : r1(nextMargin),
              nextIsRivalry,
            },
            `${label}: -${r1(marginNow)} now, then ${nextOppName}` +
              `${nextIsRivalry ? " (rivalry)" : ` (${nextMargin == null ? "?" : r1(nextMargin)})`}`);
        }
      }

      // --- letdown (emotional win last week, cupcake this week) ---
      if (prev && isFinal(prev)) {
        const prevMargin = wonBy(prev, teamId);
        if (prevMargin != null && prevMargin > 0) {
          const prevOpp = opponentOf(prev, teamId);
          const prevWasRivalry = rivalrySet.has(pairKey(teamId, prevOpp));
          const myR = rating(teamId);
          const prevOppR = rating(prevOpp);
          const prevWasUp =
            prevWasRivalry ||
            (myR != null && prevOppR != null && prevOppR >= myR - CLOSE_RATING_GAP);

          const thisOpp = opponentOf(g, teamId);
          const thisOppR = rating(thisOpp);
          const thisIsWeaker =
            myR != null && thisOppR != null && thisOppR <= myR - CLEARLY_WEAKER;

          if (prevWasUp && thisIsWeaker) {
            const prevOppName =
              prevOpp === prev.homeTeamId
                ? prev.homeTeam.canonicalName
                : prev.awayTeam.canonicalName;
            add(g, teamId, "letdown",
              {
                lastWeekBeat: prevOppName,
                lastWeekByPts: prevMargin,
                lastWeekWasRivalry: prevWasRivalry,
              },
              `${label}: beat ${prevOppName} by ${prevMargin} last wk`);
          }
        }
      }
    }
  }

  // --- write (wipe + recompute for the games in scope) ---
  const scopeIds = gamesInScope.map((g) => g.id);
  const deleted = await prisma.gameFlag.deleteMany({
    where: { gameId: { in: scopeIds } },
  });
  if (rows.length > 0) await prisma.gameFlag.createMany({ data: rows });

  // --- report ---
  console.log("============================================================");
  console.log(`Games in scope: ${gamesInScope.length}`);
  console.log(`GameFlag rows: removed ${deleted.count}, inserted ${rows.length}`);
  console.log("============================================================\n");
  for (const ft of Object.keys(counts) as FlagType[]) {
    console.log(`  ${ft.padEnd(12)} ${counts[ft]}`);
    for (const ex of examples[ft]) console.log(`      ${ex}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
