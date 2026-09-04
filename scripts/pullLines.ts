// ============================================================
// Betting line snapshots  (PROJECT_BRIEF build step 4, part 1)
// ============================================================
// Pulls the current NCAAF spread + total board from The Odds API
// and INSERTS Line rows — one per (game, sportsbook, market). Never
// updates or deletes: every run is a point-in-time snapshot, which
// is what makes closing-line-value math and honest grading possible.
//
// Spreads are normalized to OUR game's home team (negative = home
// favored), even when the Odds API lists the teams the other way for
// a neutral-site game.
//
// snapshotType is passed in, matching the brief's weekly cadence:
//   Tuesday      npm run pull-lines -- --type open
//   Wed-Fri      npm run pull-lines -- --type daily   (the default)
//   Saturday     npm run pull-lines -- --type close
//
// Cost: 2 Odds API credits per run (spreads + totals, US region).
//
// Run:  npm run pull-lines -- --type open
//       npm run pull-lines -- --season 2026 --week 3 --type daily
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek, getCfbdCallCount } from "../lib/cfbd";
import { recordCfbdUsage, recordOddsUsage } from "../lib/apiUsage";
import { buildTeamResolver } from "../lib/teamResolver";
import { normalize } from "../lib/nameMatching";
import { fetchNcaafOdds } from "../lib/oddsApi";

const prisma = new PrismaClient();

const SNAPSHOT_TYPES = ["open", "daily", "close"] as const;
type SnapshotType = (typeof SNAPSHOT_TYPES)[number];

function parseArgs(): {
  season?: number;
  week?: number;
  type: SnapshotType;
  force: boolean;
} {
  const args = process.argv.slice(2);
  const val = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const season = val("--season");
  const week = val("--week");
  if ((season && !week) || (!season && week)) {
    console.error("Pass --season AND --week together, or neither. Stopping.");
    process.exit(1);
  }
  const type = (val("--type") ?? "daily") as SnapshotType;
  if (!SNAPSHOT_TYPES.includes(type)) {
    console.error(`--type must be one of: ${SNAPSHOT_TYPES.join(", ")}. Stopping.`);
    process.exit(1);
  }
  return {
    season: season ? Number(season) : undefined,
    week: week ? Number(week) : undefined,
    type,
    force: args.includes("--force"),
  };
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

async function main() {
  const { season: sArg, week: wArg, type, force } = parseArgs();
  const { season, week } =
    sArg != null && wArg != null
      ? { season: sArg, week: wArg }
      : await getCurrentSeasonWeek();

  console.log(`Line snapshot — season ${season}, week ${week}, type "${type}"\n`);

  const teams = await buildTeamResolver(prisma, "odds_api");

  const games = await prisma.game.findMany({
    where: { season, week },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffTime: true,
      homeTeam: { select: { canonicalName: true } },
      awayTeam: { select: { canonicalName: true } },
    },
  });
  const gamesByPair = new Map<string, typeof games>();
  const gamesByTeam = new Map<string, typeof games>();
  for (const g of games) {
    const k = pairKey(g.homeTeamId, g.awayTeamId);
    (gamesByPair.get(k) ?? gamesByPair.set(k, []).get(k)!).push(g);
    (gamesByTeam.get(g.homeTeamId) ?? gamesByTeam.set(g.homeTeamId, []).get(g.homeTeamId)!).push(g);
    (gamesByTeam.get(g.awayTeamId) ?? gamesByTeam.set(g.awayTeamId, []).get(g.awayTeamId)!).push(g);
  }

  /**
   * One side of an Odds API event resolved to a team we track, the other
   * didn't — almost always an FBS-vs-FCS tune-up where the Odds API's FCS name
   * ("Tennessee State Tigers") has no alias, which would otherwise drop the
   * whole event and cost the FBS team its line too. Use OUR schedule to name
   * the mystery team: it must be the known team's opponent this week.
   */
  function rescueOpponent(
    knownId: string,
    oddsName: string,
    commenceMs: number
  ): { id: string; canonicalName: string } | null {
    const ev = normalize(oddsName);
    if (ev.length === 0) return null;
    const scored = (gamesByTeam.get(knownId) ?? []).map((g) => {
      const opp =
        g.homeTeamId === knownId
          ? { id: g.awayTeamId, canonicalName: g.awayTeam.canonicalName }
          : { id: g.homeTeamId, canonicalName: g.homeTeam.canonicalName };
      const on = normalize(opp.canonicalName);
      return {
        opp,
        // opponent's full name is the leading run of words in the Odds name
        prefix: on.length > 0 && on.every((w, i) => ev[i] === w),
        dt: Math.abs(g.kickoffTime.getTime() - commenceMs),
      };
    });
    // 1) name lines up cleanly — confident even if the team has a bye-less
    //    doubleheader somewhere
    const clean = scored.filter((s) => s.prefix);
    if (clean.length === 1) return clean[0].opp;
    // 2) name doesn't line up ("Albany" vs our "UAlbany", "Citadel" vs "The
    //    Citadel"), but the known team has exactly one game this week and its
    //    kickoff matches the event — the opponent is whoever that is.
    const near = scored.filter((s) => s.dt <= 26 * 3_600_000);
    if (near.length === 1) return near[0].opp;
    return null;
  }

  async function learnAlias(sourceName: string, teamId: string) {
    await prisma.teamSourceAlias.upsert({
      where: { source_sourceName: { source: "odds_api", sourceName } },
      update: { teamId, confidence: "auto_matched" },
      create: { source: "odds_api", sourceName, teamId, confidence: "auto_matched" },
    });
  }

  // Guard against an accidental double-run of the once-only snapshots.
  // SKIP (exit 0), don't fail — this runs unattended from a scheduled
  // workflow, and a hard failure here would kill the rest of that
  // workflow's `&&` chain (kalshi/flags/model/picks) every time it fires
  // for a week that's already been touched. --force still adds another.
  if ((type === "open" || type === "close") && !force) {
    const existing = await prisma.line.count({
      where: { snapshotType: type, game: { season, week } },
    });
    if (existing > 0) {
      console.log(
        `There are already ${existing} "${type}" line rows for season ${season} ` +
          `week ${week} — skipping (re-run with --force to add another "${type}" ` +
          `snapshot anyway).`
      );
      await recordCfbdUsage(prisma, getCfbdCallCount());
      await prisma.$disconnect();
      return;
    }
  }

  // Hard budget backstop. The Odds API's own header tells us how many credits
  // are left this calendar month (persisted on every pull). If we're near the
  // floor, skip the call and exit cleanly — better to lose a few hours of line
  // refresh at month's end (the slate is already captured, and it resets on the
  // 1st) than to blow the 500/mo cap and start getting API errors. --force
  // overrides. This makes the aggressive cadence safe even in a 5-Saturday
  // month like October 2026 (5 Sat + 5 Fri, its theoretical max is right at 500).
  const ODDS_FLOOR = 15;
  const ym = new Date().toISOString().slice(0, 7);
  const priorUsage = await prisma.apiUsage.findUnique({
    where: { api_yearMonth: { api: "odds", yearMonth: ym } },
  });
  if (!force && priorUsage?.lastRemaining != null && priorUsage.lastRemaining < ODDS_FLOOR) {
    console.log(
      `The Odds API is down to ${priorUsage.lastRemaining} credits for ${ym} — ` +
        `skipping this pull to stay under the monthly cap (resets on the 1st; ` +
        `--force overrides).`
    );
    await recordCfbdUsage(prisma, getCfbdCallCount());
    await prisma.$disconnect();
    return;
  }

  console.log("Pulling spreads + totals from The Odds API...");
  const { events, creditsRemaining, creditsLastCost } = await fetchNcaafOdds([
    "spreads",
    "totals",
  ]);
  console.log(
    `  -> ${events.length} events. Cost ${creditsLastCost ?? "?"} credits, ` +
      `${creditsRemaining ?? "?"} remaining this month.`
  );
  await recordOddsUsage(prisma, { remaining: creditsRemaining, cost: creditsLastCost });

  const rows: Prisma.LineCreateManyInput[] = [];
  const now = Date.now();
  const GRACE_MS = 10 * 60_000; // a pull landing within 10 min of kickoff still counts
  let matchedGames = 0;
  let unresolvedEvents = 0;
  let rescued = 0;
  let noGame = 0;
  let liveSkipped = 0;
  const gamesWithLines = new Set<string>();

  for (const ev of events) {
    let homeId = teams.resolve(ev.home_team);
    let awayId = teams.resolve(ev.away_team);

    // rescue an FBS-vs-FCS event where only the FCS name failed to resolve
    if (homeId && !awayId) {
      const r = rescueOpponent(homeId, ev.away_team, Date.parse(ev.commence_time));
      if (r) {
        awayId = r.id;
        teams.register(ev.away_team, r.id);
        await learnAlias(ev.away_team, r.id);
        rescued++;
      }
    } else if (awayId && !homeId) {
      const r = rescueOpponent(awayId, ev.home_team, Date.parse(ev.commence_time));
      if (r) {
        homeId = r.id;
        teams.register(ev.home_team, r.id);
        await learnAlias(ev.home_team, r.id);
        rescued++;
      }
    }

    if (!homeId || !awayId) {
      unresolvedEvents++;
      continue;
    }

    const candidates = gamesByPair.get(pairKey(homeId, awayId));
    if (!candidates || candidates.length === 0) {
      noGame++;
      continue;
    }
    // Closest kickoff to the event's commence_time (handles the rare
    // same-matchup-twice case).
    const commence = Date.parse(ev.commence_time);
    const game = candidates.reduce((best, g) =>
      Math.abs(g.kickoffTime.getTime() - commence) <
      Math.abs(best.kickoffTime.getTime() - commence)
        ? g
        : best
    );

    // Once a game kicks off The Odds API keeps serving LIVE in-game prices
    // (a team up 21 shows as -35). Recording those poisons everything
    // downstream — consensus, the movement arrow, steam/rlm all read a
    // ~40-pt "move". The last pre-kick pull is our de facto close; stop there.
    if (game.kickoffTime.getTime() + GRACE_MS <= now && !force) {
      liveSkipped++;
      continue;
    }
    matchedGames++;

    for (const bk of ev.bookmakers) {
      for (const market of bk.markets) {
        if (market.key === "spreads") {
          const home = market.outcomes.find(
            (o) => teams.resolve(o.name) === game.homeTeamId
          );
          const away = market.outcomes.find(
            (o) => teams.resolve(o.name) === game.awayTeamId
          );
          let lineValue: number | undefined;
          let price: number | null = null;
          if (home?.point != null) {
            lineValue = home.point;
            price = home.price ?? null;
          } else if (away?.point != null) {
            lineValue = -away.point; // flip to home perspective
          }
          if (lineValue == null) continue;
          rows.push({
            gameId: game.id,
            sportsbook: bk.key,
            market: "spread",
            lineValue,
            price,
            snapshotType: type,
          });
          gamesWithLines.add(game.id);
        } else if (market.key === "totals") {
          const over = market.outcomes.find((o) => o.name === "Over");
          const point = over?.point ?? market.outcomes[0]?.point;
          if (point == null) continue;
          rows.push({
            gameId: game.id,
            sportsbook: bk.key,
            market: "total",
            lineValue: point,
            price: over?.price ?? null,
            snapshotType: type,
          });
          gamesWithLines.add(game.id);
        }
      }
    }
  }

  if (rows.length > 0) {
    await prisma.line.createMany({ data: rows });
  }

  // Safety net: sweep any post-kickoff odds_api rows that slipped in before this
  // guard existed, from a --force run, or a kickoff that got pushed back. The
  // GRACE_MS window keeps a pull that lands right at kickoff as the close.
  const kickedOff = games.filter((g) => g.kickoffTime.getTime() + GRACE_MS <= now);
  let swept = 0;
  if (kickedOff.length > 0) {
    const r = await prisma.line.deleteMany({
      where: {
        source: "odds_api",
        OR: kickedOff.map((g) => ({
          gameId: g.id,
          capturedAt: { gt: new Date(g.kickoffTime.getTime() + GRACE_MS) },
        })),
      },
    });
    swept = r.count;
  }

  const gamesNoLine = games.length - gamesWithLines.size;

  // ---------- Report ----------
  console.log("\n============================================================");
  console.log(`DONE. season ${season}, week ${week}, snapshot "${type}"`);
  console.log(`  Line rows inserted:        ${rows.length}`);
  console.log(`   - spreads:                ${rows.filter((r) => r.market === "spread").length}`);
  console.log(`   - totals:                 ${rows.filter((r) => r.market === "total").length}`);
  console.log(`  Games matched to a line:   ${gamesWithLines.size} / ${games.length}`);
  if (rescued > 0) {
    console.log(`  FCS opponents rescued via the schedule (alias learned): ${rescued}`);
  }
  if (liveSkipped > 0) {
    console.log(`  Skipped ${liveSkipped} events for games already kicked off (live prices).`);
  }
  if (swept > 0) {
    console.log(`  Swept ${swept} stale post-kickoff line rows.`);
  }
  console.log("============================================================\n");

  if (unresolvedEvents > 0) {
    console.log(
      `${unresolvedEvents} Odds API events had a team we couldn't resolve ` +
        "(FCS-vs-FCS we don't track, or an FCS name the schedule rescue couldn't " +
        "pin to an opponent) — skipped."
    );
  }
  if (noGame > 0) {
    console.log(
      `${noGame} events resolved to teams but had no matching game this week — skipped.`
    );
  }
  if (gamesNoLine > 0) {
    console.log(
      `${gamesNoLine} of our week-${week} games have no line yet ` +
        "(lines not posted, or an FBS-vs-FCS game the book isn't pricing)."
    );
  }

  await recordCfbdUsage(prisma, getCfbdCallCount());
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
