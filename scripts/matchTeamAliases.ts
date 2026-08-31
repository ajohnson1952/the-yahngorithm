// ============================================================
// One-time (and re-runnable) team alias backfill
// ============================================================
// What this does:
//   1. Pulls the full FBS team list from CFBD — this is our source
//      of truth / canonical list, since it's the cleanest, most
//      structured source of the three.
//   2. Pulls team names as they appear in The Odds API and ESPN.
//   3. Matches each against the canonical CFBD list using the
//      word-overlap logic in lib/nameMatching.ts.
//   4. Writes everything into the team_source_aliases table via
//      Prisma, tagging each match as 'auto_matched' or
//      'needs_review'.
//   5. Prints a report at the end so you can eyeball anything
//      flagged before it touches real game data.
//
// Run with:  npx tsx scripts/matchTeamAliases.ts
// Requires:  CFBD_API_KEY and ODDS_API_KEY in your .env file
// ============================================================

import { PrismaClient } from "@prisma/client";
import { matchTeamName, CanonicalTeam } from "../lib/nameMatching";

const prisma = new PrismaClient();

const CFBD_API_KEY = process.env.CFBD_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

if (!CFBD_API_KEY || !ODDS_API_KEY) {
  console.error("Missing CFBD_API_KEY or ODDS_API_KEY in your .env file. Stopping.");
  process.exit(1);
}

// ---------- Step 1: Pull the canonical team list from CFBD ----------

async function fetchCfbdTeams(): Promise<{ school: string; conference: string | null }[]> {
  const res = await fetch("https://api.collegefootballdata.com/teams/fbs", {
    headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`CFBD teams request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.map((t: any) => ({ school: t.school, conference: t.conference ?? null }));
}

// ---------- Step 2: Pull team names as The Odds API sees them ----------
// The Odds API doesn't have a dedicated "teams" endpoint — team names
// show up inside game/odds objects (home_team / away_team fields).
// We pull the current odds board and collect the unique names.

async function fetchOddsApiTeamNames(): Promise<string[]> {
  const res = await fetch(
    `https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads`
  );
  if (!res.ok) {
    throw new Error(`Odds API request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const names = new Set<string>();
  for (const game of data) {
    names.add(game.home_team);
    names.add(game.away_team);
  }
  return [...names];
}

// ---------- Step 3: Pull team names as ESPN sees them ----------
// ESPN's public (unofficial) scoreboard/team endpoints. This hits the
// FBS teams list.

async function fetchEspnTeamNames(): Promise<string[]> {
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=200"
  );
  if (!res.ok) {
    throw new Error(`ESPN request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map((t: any) => t.team.displayName as string);
}

// ---------- Main ----------

async function main() {
  console.log("Pulling canonical team list from CFBD...");
  const cfbdTeams = await fetchCfbdTeams();
  console.log(`  -> ${cfbdTeams.length} teams found.`);

  console.log("Seeding canonical teams table...");
  const canonicalTeams: CanonicalTeam[] = [];
  for (const t of cfbdTeams) {
    const team = await prisma.team.upsert({
      where: { canonicalName: t.school },
      update: { conference: t.conference ?? undefined },
      create: { canonicalName: t.school, conference: t.conference ?? undefined },
    });
    canonicalTeams.push({ id: team.id, canonicalName: team.canonicalName });

    // The team's own CFBD name is a confirmed alias of itself.
    await prisma.teamSourceAlias.upsert({
      where: { source_sourceName: { source: "cfbd", sourceName: t.school } },
      update: { teamId: team.id, confidence: "confirmed" },
      create: { teamId: team.id, source: "cfbd", sourceName: t.school, confidence: "confirmed" },
    });
  }

  console.log("Pulling team names from The Odds API...");
  const oddsNames = await fetchOddsApiTeamNames();
  console.log(`  -> ${oddsNames.length} unique names found.`);

  console.log("Pulling team names from ESPN...");
  const espnNames = await fetchEspnTeamNames();
  console.log(`  -> ${espnNames.length} unique names found.`);

  const needsReview: { source: string; sourceName: string; candidates: string[] }[] = [];

  async function matchAndStore(source: "odds_api" | "espn", names: string[]) {
    for (const name of names) {
      const result = matchTeamName(name, canonicalTeams);

      if (result.teamId) {
        await prisma.teamSourceAlias.upsert({
          where: { source_sourceName: { source, sourceName: name } },
          update: { teamId: result.teamId, confidence: result.confidence },
          create: { teamId: result.teamId, source, sourceName: name, confidence: result.confidence },
        });
      }

      if (result.confidence === "needs_review") {
        needsReview.push({ source, sourceName: name, candidates: result.candidatesConsidered });
      }
    }
  }

  console.log("Matching Odds API names against canonical list...");
  await matchAndStore("odds_api", oddsNames);

  console.log("Matching ESPN names against canonical list...");
  await matchAndStore("espn", espnNames);

  // ---------- Report ----------

  console.log("\n============================================================");
  console.log("DONE. Summary:");
  console.log(`  Canonical teams (from CFBD): ${canonicalTeams.length}`);
  console.log(`  Odds API names processed:    ${oddsNames.length}`);
  console.log(`  ESPN names processed:        ${espnNames.length}`);
  console.log(`  Flagged for manual review:   ${needsReview.length}`);
  console.log("============================================================\n");

  if (needsReview.length > 0) {
    console.log("These need a human look before they're trusted:\n");
    for (const item of needsReview) {
      console.log(
        `  [${item.source}] "${item.sourceName}" -> no clean match. ` +
          (item.candidates.length
            ? `Ambiguous between: ${item.candidates.join(", ")}`
            : "No candidates found at all.")
      );
    }
    console.log(
      "\nFix these by hand in team_source_aliases (set confidence to 'confirmed' " +
        "once you've picked the right team_id), or adjust the source name and re-run this script."
    );
  } else {
    console.log("Everything matched cleanly. No manual review needed this run.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
