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

interface CfbdTeam {
  school: string;
  conference: string | null;
  mascot: string | null;
  alternateNames: string[];
}

async function fetchCfbdTeams(): Promise<CfbdTeam[]> {
  const res = await fetch("https://api.collegefootballdata.com/teams/fbs", {
    headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`CFBD teams request failed: ${res.status} ${res.statusText}`);
  }
  const data: any = await res.json();
  return data.map((t: any) => ({
    school: t.school,
    conference: t.conference ?? null,
    // mascot + alternateNames are what let the matcher tell "Alabama"
    // apart from "North Alabama" — see lib/nameMatching.ts.
    mascot: t.mascot ?? null,
    alternateNames: Array.isArray(t.alternateNames) ? t.alternateNames : [],
  }));
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
  const data: any = await res.json();
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
  // limit=900 returns ESPN's entire CFB team list (~760, all divisions).
  // We WANT the wide net: names that aren't FBS simply won't match the
  // canonical list. A smaller limit silently drops real FBS teams.
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=900"
  );
  if (!res.ok) {
    throw new Error(`ESPN request failed: ${res.status} ${res.statusText}`);
  }
  const data: any = await res.json();
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
    canonicalTeams.push({
      id: team.id,
      canonicalName: team.canonicalName,
      mascot: t.mascot,
      altNames: t.alternateNames,
    });

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

  // Two very different situations, kept apart in the report:
  //  - ambiguous: we DID match a team but couldn't do it confidently
  //    (two canonical teams fit equally well). Always worth a human look.
  //  - unmatched: no canonical team fit at all. Usually just a non-FBS
  //    opponent showing up on the odds board / in ESPN's all-divisions
  //    list — expected noise, not a bug.
  const ambiguous: { source: string; sourceName: string; candidates: string[] }[] = [];
  const unmatched: { source: string; sourceName: string }[] = [];
  let autoMatched = 0;

  async function matchAndStore(source: "odds_api" | "espn", names: string[]) {
    for (const name of names) {
      const result = matchTeamName(name, canonicalTeams);

      if (result.teamId) {
        await prisma.teamSourceAlias.upsert({
          where: { source_sourceName: { source, sourceName: name } },
          update: { teamId: result.teamId, confidence: result.confidence },
          create: { teamId: result.teamId, source, sourceName: name, confidence: result.confidence },
        });
        if (result.confidence === "auto_matched") autoMatched++;
        else ambiguous.push({ source, sourceName: name, candidates: result.candidatesConsidered });
      } else {
        unmatched.push({ source, sourceName: name });
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
  console.log(`  Auto-matched confidently:    ${autoMatched}`);
  console.log(`  Ambiguous (need a decision): ${ambiguous.length}`);
  console.log(`  No match (likely non-FBS):   ${unmatched.length}`);
  console.log("============================================================\n");

  if (ambiguous.length > 0) {
    console.log(">> AMBIGUOUS — matched, but not confidently. Check each one:\n");
    for (const item of ambiguous) {
      console.log(
        `  [${item.source}] "${item.sourceName}" -> could be: ${item.candidates.join(", ")}`
      );
    }
    console.log(
      "\nResolve in team_source_aliases: pick the right team_id and set confidence to 'confirmed'.\n"
    );
  } else {
    console.log("No ambiguous matches this run.\n");
  }

  // Odds API unmatched = teams in real betting games we couldn't identify.
  // Worth reading every one. ESPN unmatched = mostly its full lower-division
  // team list (D2/D3), which is expected noise — just show the count.
  const oddsUnmatched = unmatched.filter((u) => u.source === "odds_api");
  const espnUnmatched = unmatched.filter((u) => u.source === "espn");

  if (oddsUnmatched.length > 0) {
    console.log(
      `>> ODDS API — NO MATCH (${oddsUnmatched.length}). These are teams in live betting games.`
    );
    console.log("   Each should be a non-FBS opponent (FBS-vs-FCS game). If you see a real");
    console.log("   FBS team here, it's a name format the matcher doesn't handle yet:\n");
    for (const item of oddsUnmatched) {
      console.log(`  "${item.sourceName}"`);
    }
    console.log("");
  }

  console.log(
    `>> ESPN — NO MATCH (${espnUnmatched.length}). Expected: ESPN's team list spans all` +
      " divisions;\n   the non-FBS ones don't match by design. Not a problem."
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
