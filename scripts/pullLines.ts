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
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";
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
    },
  });
  const gamesByPair = new Map<string, typeof games>();
  for (const g of games) {
    const k = pairKey(g.homeTeamId, g.awayTeamId);
    const list = gamesByPair.get(k);
    if (list) list.push(g);
    else gamesByPair.set(k, [g]);
  }

  // Guard against an accidental double-run of the once-only snapshots.
  if ((type === "open" || type === "close") && !force) {
    const existing = await prisma.line.count({
      where: { snapshotType: type, game: { season, week } },
    });
    if (existing > 0) {
      console.error(
        `There are already ${existing} "${type}" line rows for season ${season} ` +
          `week ${week}.\nRe-run with --force if you really mean to add another ` +
          `"${type}" snapshot.`
      );
      process.exit(1);
    }
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

  const rows: Prisma.LineCreateManyInput[] = [];
  let matchedGames = 0;
  let unresolvedEvents = 0;
  let noGame = 0;
  const gamesWithLines = new Set<string>();

  for (const ev of events) {
    const homeId = teams.resolve(ev.home_team);
    const awayId = teams.resolve(ev.away_team);
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

  const gamesNoLine = games.length - gamesWithLines.size;

  // ---------- Report ----------
  console.log("\n============================================================");
  console.log(`DONE. season ${season}, week ${week}, snapshot "${type}"`);
  console.log(`  Line rows inserted:        ${rows.length}`);
  console.log(`   - spreads:                ${rows.filter((r) => r.market === "spread").length}`);
  console.log(`   - totals:                 ${rows.filter((r) => r.market === "total").length}`);
  console.log(`  Games matched to a line:   ${gamesWithLines.size} / ${games.length}`);
  console.log("============================================================\n");

  if (unresolvedEvents > 0) {
    console.log(
      `${unresolvedEvents} Odds API events had a team we couldn't resolve ` +
        "(usually FCS-vs-FCS games we don't track) — skipped."
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

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
