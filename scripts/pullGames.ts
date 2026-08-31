// ============================================================
// Schedule / results pull  (PROJECT_BRIEF build step 3, part 2)
// ============================================================
// Pulls games from CFBD /games into the Game table — one week, or
// the whole regular season with --all.
//
//  - Keeps only games with at least one FBS team.
//  - Resolves both team names to our Team.id via the alias table.
//  - A non-FBS opponent that doesn't resolve gets a minimal Team row
//    created (classification 'fcs'/'ii'/'iii', never rated) so the
//    Game can reference real IDs. An unresolved *FBS* team is a bug
//    and is reported loudly, not papered over.
//  - Fills venue lat/lng from CFBD /venues (needed later for the
//    travel flag and weather).
//
// Idempotent: upserts on (season, week, homeTeamId, awayTeamId), so
// re-running after games finish just fills in the scores.
//
// Run:  npm run pull-games                    (current week)
//       npm run pull-games -- --season 2026 --week 3
//       npm run pull-games -- --all            (whole regular season, 1 CFBD call)
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet, getCurrentSeasonWeek } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface CfbdGame {
  id: number;
  season: number;
  week: number;
  seasonType: string;
  startDate: string;
  startTimeTBD: boolean;
  completed: boolean;
  neutralSite: boolean;
  venue: string | null;
  venueId: number | null;
  homeId: number;
  homeTeam: string;
  homeClassification: string | null;
  homeConference: string | null;
  homePoints: number | null;
  awayId: number;
  awayTeam: string;
  awayClassification: string | null;
  awayConference: string | null;
  awayPoints: number | null;
}

interface CfbdVenue {
  id: number;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  dome: boolean | null;
}

function parseArgs(): { season?: number; week?: number; all: boolean } {
  const args = process.argv.slice(2);
  const val = (flag: string) => {
    const i = args.indexOf(flag);
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

async function main() {
  const override = parseArgs();
  const current = await getCurrentSeasonWeek();
  const season = override.season ?? current.season;
  const week = override.all ? null : override.week ?? current.week;

  console.log(
    override.all
      ? `Schedule pull for the FULL ${season} regular season\n`
      : `Schedule pull for season ${season}, week ${week}\n`
  );

  const teams = await buildTeamResolver(prisma, "cfbd");

  console.log("Pulling games and venues from CFBD...");
  const gamesPath =
    week == null ? `/games?year=${season}` : `/games?year=${season}&week=${week}`;
  const [allGames, venues] = await Promise.all([
    cfbdGet<CfbdGame[]>(gamesPath),
    cfbdGet<CfbdVenue[]>(`/venues`),
  ]);

  const venueById = new Map(venues.map((v) => [v.id, v]));
  const games = allGames.filter(
    (g) =>
      g.seasonType === "regular" &&
      (g.homeClassification === "fbs" || g.awayClassification === "fbs")
  );
  const weeksCovered = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  console.log(
    `  -> ${allGames.length} games pulled, ${games.length} involving an FBS team ` +
      `(week${weeksCovered.length > 1 ? "s" : ""} ${weeksCovered.join(", ")})`
  );

  // Resolve a team name; if it's a non-FBS opponent we've never seen, create it.
  const createdOpponents: string[] = [];
  const unresolvedFbs = new Set<string>();

  async function resolveOrCreate(
    name: string,
    classification: string | null,
    conference: string | null
  ): Promise<string | null> {
    const existing = teams.resolve(name);
    if (existing) return existing;

    if (classification === "fbs") {
      unresolvedFbs.add(name);
      return null;
    }

    // Minimal identity row for a lower-division opponent. Never rated.
    const created = await prisma.team.create({
      data: {
        canonicalName: name,
        conference: conference ?? undefined,
        classification: classification ?? "fcs",
        aliases: {
          create: { source: "cfbd", sourceName: name, confidence: "confirmed" },
        },
      },
    });
    teams.register(name, created.id, { fbs: false });
    createdOpponents.push(`${name} (${classification ?? "fcs"})`);
    return created.id;
  }

  let wrote = 0;
  let fbsVsFbs = 0;
  let skipped = 0;
  let missingCoords = 0;

  for (const g of games) {
    const homeTeamId = await resolveOrCreate(
      g.homeTeam,
      g.homeClassification,
      g.homeConference
    );
    const awayTeamId = await resolveOrCreate(
      g.awayTeam,
      g.awayClassification,
      g.awayConference
    );

    if (!homeTeamId || !awayTeamId) {
      skipped++;
      continue;
    }

    if (g.homeClassification === "fbs" && g.awayClassification === "fbs") {
      fbsVsFbs++;
    }

    const venue = g.venueId != null ? venueById.get(g.venueId) : undefined;
    const venueLat = venue?.latitude ?? null;
    const venueLng = venue?.longitude ?? null;
    if (venueLat == null || venueLng == null) missingCoords++;

    const fields = {
      kickoffTime: new Date(g.startDate),
      neutralSite: g.neutralSite,
      venue: g.venue ?? null,
      venueId: g.venueId ?? null,
      venueLat,
      venueLng,
      indoor: venue?.dome === true,
      homeScore: g.homePoints,
      awayScore: g.awayPoints,
      status: g.completed ? "final" : "scheduled",
    };

    await prisma.game.upsert({
      where: {
        season_week_homeTeamId_awayTeamId: {
          season: g.season,
          week: g.week,
          homeTeamId,
          awayTeamId,
        },
      },
      update: fields,
      create: {
        season: g.season,
        week: g.week,
        homeTeamId,
        awayTeamId,
        ...fields,
      },
    });
    wrote++;
  }

  // ---------- Report ----------
  console.log("\n============================================================");
  console.log(
    override.all
      ? `DONE. ${season} regular season, weeks ${weeksCovered.join(", ")}`
      : `DONE. season ${season}, week ${week}`
  );
  console.log(`  Games written:        ${wrote}`);
  console.log(`   - FBS vs FBS:         ${fbsVsFbs}`);
  console.log(`   - FBS vs lower div:   ${wrote - fbsVsFbs}`);
  console.log(`  Non-FBS teams created: ${createdOpponents.length}`);
  console.log(`  Games skipped:         ${skipped}`);
  console.log("============================================================\n");

  if (createdOpponents.length > 0) {
    console.log("New non-FBS opponent identity rows (no ratings, ever):");
    for (const n of createdOpponents) console.log(`  + ${n}`);
    console.log("");
  }

  if (unresolvedFbs.size > 0) {
    console.log(`>> PROBLEM — FBS teams that didn't resolve (${unresolvedFbs.size}):`);
    for (const n of unresolvedFbs) console.log(`  "${n}"`);
    console.log(
      "\n   These are real FBS teams. Their 'cfbd' alias is missing or wrong.\n" +
        "   Fix team_source_aliases, then re-run. Their games were NOT stored.\n"
    );
  }

  if (missingCoords > 0) {
    console.log(
      `Note: ${missingCoords} game(s) have no venue coordinates (CFBD had no lat/lng ` +
        "for that venue). Weather / travel calcs will skip those until it's filled in."
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
