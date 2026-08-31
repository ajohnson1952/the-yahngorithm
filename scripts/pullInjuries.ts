// ============================================================
// Injury report  (PROJECT_BRIEF: ESPN unofficial API)
// ============================================================
// For each FBS team playing in the target week, pull ESPN's injury
// list, keep only impact players (QBs always; other skill players and
// premium defenders when Out/Doubtful), and attach them to that
// team's game in the Injury table.
//
// Heads up: ESPN's college-football injury data is thin, especially
// early in the season — a light week is normal, not a bug. The brief
// wants this run Saturday morning as the final pre-kickoff look.
//
// Wipes + rewrites injuries for the target week's games each run.
// No API key needed.
//
// Run:  npm run pull-injuries
//       npm run pull-injuries -- --season 2026 --week 3
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";

const prisma = new PrismaClient();
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";

// positions we care about; everything else (OL, K, P, LS, …) is dropped
const SKILL = new Set(["QB", "RB", "FB", "WR", "TE"]);
const DEFENSE = new Set([
  "DE", "EDGE", "DT", "NT", "DL", "LB", "ILB", "OLB", "MLB",
  "CB", "S", "FS", "SS", "DB",
]);
const STALE_DAYS = 45;

function parseArgs(): { season?: number; week?: number } {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url.replace(/^http:/, "https:"));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeStatus(s: string | undefined): string | null {
  const t = (s ?? "").toLowerCase();
  if (t.includes("out")) return "out";
  if (t.includes("doubtful")) return "doubtful";
  if (t.includes("questionable") || t.includes("day")) return "questionable";
  return null; // Probable / Active / unknown -> not worth storing
}

async function main() {
  const o = parseArgs();
  const { season, week } =
    o.season != null && o.week != null
      ? { season: o.season, week: o.week }
      : await getCurrentSeasonWeek();

  console.log(`Injury report — season ${season}, week ${week}\n`);

  const games = await prisma.game.findMany({
    where: { season, week },
    include: { homeTeam: true, awayTeam: true },
  });

  // team.id -> the game it plays this week (each team plays once)
  const gameByTeam = new Map<string, (typeof games)[number]>();
  for (const g of games) {
    gameByTeam.set(g.homeTeamId, g);
    gameByTeam.set(g.awayTeamId, g);
  }

  const fbsTeams = await prisma.team.findMany({
    where: {
      classification: "fbs",
      espnId: { not: null },
      id: { in: [...gameByTeam.keys()] },
    },
    select: { id: true, canonicalName: true, espnId: true },
  });

  const cutoff = Date.now() - STALE_DAYS * 86_400_000;
  const athleteCache = new Map<string, any>();
  const rows: Prisma.InjuryCreateManyInput[] = [];
  const kept: string[] = [];
  let teamsWithData = 0;

  for (const team of fbsTeams) {
    const list = await getJson(`${CORE}/teams/${team.espnId}/injuries?limit=100`);
    await sleep(80);
    const items: any[] = list?.items ?? [];
    if (items.length === 0) continue;
    let teamKept = 0;

    for (const it of items) {
      const inj = it.$ref ? await getJson(it.$ref) : it;
      await sleep(60);
      if (!inj) continue;

      const status = normalizeStatus(inj.status ?? inj.type?.description);
      if (!status) continue;
      if (inj.date && Date.parse(inj.date) < cutoff) continue; // stale record

      const athRef: string | undefined = inj.athlete?.$ref;
      let ath = inj.athlete;
      if (athRef) {
        ath = athleteCache.get(athRef) ?? (await getJson(athRef));
        if (athRef) athleteCache.set(athRef, ath);
        await sleep(60);
      }
      const position: string | undefined =
        ath?.position?.abbreviation ?? ath?.position?.name;
      const name: string | undefined = ath?.displayName ?? ath?.fullName;
      if (!name || !position) continue;

      const isSkill = SKILL.has(position);
      const isDefense = DEFENSE.has(position);
      if (!isSkill && !isDefense) continue;

      // QB at any status; everyone else only if Out/Doubtful
      const impact =
        position === "QB" || status === "out" || status === "doubtful";
      if (!impact) continue;

      const g = gameByTeam.get(team.id)!;
      rows.push({
        gameId: g.id,
        teamId: team.id,
        playerName: name,
        position,
        isImpactPlayer: true,
        status,
      });
      teamKept++;
      kept.push(`${team.canonicalName}: ${position} ${name} — ${status}`);
    }

    if (teamKept > 0) teamsWithData++;
  }

  // wipe + rewrite for this week's games
  const gameIds = games.map((g) => g.id);
  const deleted = await prisma.injury.deleteMany({
    where: { gameId: { in: gameIds } },
  });
  if (rows.length > 0) await prisma.injury.createMany({ data: rows });

  console.log("============================================================");
  console.log(`Injury rows: removed ${deleted.count}, inserted ${rows.length}`);
  console.log(`Teams with a tracked injury: ${teamsWithData} / ${fbsTeams.length}`);
  console.log("============================================================\n");
  for (const k of kept) console.log("  " + k);
  if (rows.length === 0) {
    console.log("  (ESPN has no impact-player injuries listed for this week's teams.)");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
