// ============================================================
// Weekly ratings pull  (PROJECT_BRIEF build step 3, part 1)
// ============================================================
// Pulls SP+ and SRS from CFBD and snapshots them into
// TeamRatingWeekly, one row per (team, season, week).
//
//   SP+  (/ratings/sp)  — opponent-adjusted play-by-play efficiency,
//                         FBS only, has offense/defense split.
//   SRS  (/ratings/srs) — opponent-adjusted scoring margin, same
//                         points scale, single number. Computed from
//                         games played, so it's EMPTY until a few
//                         weeks into the season — that's expected.
//
// Every run is a snapshot (pulledAt), never destructive. Re-running
// for the same (season, week) overwrites that week's numbers with
// the latest — which is what you want on the Tuesday refresh.
//
// Run:  npm run pull-ratings           (auto season/week from calendar)
//       npm run pull-ratings -- --season 2026 --week 3   (explicit)
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet, getCurrentSeasonWeek } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";
import { paceByTeamName } from "../lib/pace";

const prisma = new PrismaClient();

interface SpRow {
  year: number;
  team: string;
  conference: string | null;
  rating: number | null;
  offense?: { rating: number | null } | null;
  defense?: { rating: number | null } | null;
}
interface SrsRow {
  year: number;
  team: string;
  rating: number | null;
}

function parseArgs(): { season?: number; week?: number } {
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
  return {
    season: season ? Number(season) : undefined,
    week: week ? Number(week) : undefined,
  };
}

async function main() {
  const override = parseArgs();
  const { season, week } =
    override.season != null && override.week != null
      ? { season: override.season, week: override.week }
      : await getCurrentSeasonWeek();

  console.log(`Ratings snapshot for season ${season}, week ${week}\n`);

  const teams = await buildTeamResolver(prisma, "cfbd");

  console.log("Pulling SP+, SRS, and pace from CFBD...");
  const [sp, srs, pace] = await Promise.all([
    cfbdGet<SpRow[]>(`/ratings/sp?year=${season}`),
    cfbdGet<SrsRow[]>(`/ratings/srs?year=${season}`),
    paceByTeamName(season),
  ]);
  console.log(
    `  -> SP+ rows: ${sp.length}, SRS rows: ${srs.length}, pace for ${pace.size} teams`
  );

  const srsByName = new Map(srs.map((r) => [r.team, r.rating]));

  const unmatched: string[] = [];
  let wrote = 0;
  let withSrs = 0;
  const ratedTeamIds = new Set<string>();

  for (const row of sp) {
    // CFBD tacks a "nationalAverages" pseudo-row onto SP+ — not a team.
    if (!row.team || row.team === "nationalAverages") continue;

    const teamId = teams.resolve(row.team);
    if (!teamId) {
      unmatched.push(row.team);
      continue;
    }

    const srsRating = srsByName.get(row.team) ?? null;
    if (srsRating != null) withSrs++;
    const possessions = pace.get(row.team) ?? null;

    await prisma.teamRatingWeekly.upsert({
      where: { teamId_season_week: { teamId, season, week } },
      update: {
        spPlusOverall: row.rating ?? null,
        spPlusOffense: row.offense?.rating ?? null,
        spPlusDefense: row.defense?.rating ?? null,
        srs: srsRating,
        avgPossessionsPerGame: possessions,
        pulledAt: new Date(),
      },
      create: {
        teamId,
        season,
        week,
        spPlusOverall: row.rating ?? null,
        spPlusOffense: row.offense?.rating ?? null,
        spPlusDefense: row.defense?.rating ?? null,
        srs: srsRating,
        avgPossessionsPerGame: possessions,
      },
    });
    wrote++;
    ratedTeamIds.add(teamId);
  }

  const missing = [...teams.fbsTeamIds]
    .filter((id) => !ratedTeamIds.has(id))
    .map((id) => teams.canonicalById.get(id) ?? id);

  // ---------- Report ----------
  console.log("\n============================================================");
  console.log(`DONE. season ${season}, week ${week}`);
  console.log(`  Teams written to TeamRatingWeekly: ${wrote}`);
  console.log(`  ...of those with an SRS value:     ${withSrs}`);
  console.log("============================================================\n");

  if (withSrs === 0) {
    console.log(
      "SRS is empty — normal in the first few weeks (it needs games played).\n" +
        "The SRS spread model stays dormant until this fills in (~week 3-4).\n"
    );
  }

  if (unmatched.length > 0) {
    console.log(`>> SP+ names that didn't resolve to a team (${unmatched.length}):`);
    for (const n of unmatched) console.log(`  "${n}"`);
    console.log(
      "\n   If any is a real FBS team, add/fix its 'cfbd' alias in team_source_aliases.\n"
    );
  }

  if (missing.length > 0) {
    console.log(`>> FBS teams with NO rating row this week (${missing.length}):`);
    console.log("   " + missing.join(", "));
    console.log("   (Expected if CFBD hasn't published a rating for them yet.)");
  } else {
    console.log("Every FBS team has a rating row for this week.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
