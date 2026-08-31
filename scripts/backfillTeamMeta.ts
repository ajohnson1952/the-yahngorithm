// ============================================================
// Backfill team metadata from CFBD  (situational-flags prerequisite)
// ============================================================
// Fills in each FBS team's home-stadium location (lat / lng /
// timezone / elevation) — needed for the 'travel' situational flag —
// plus logo URLs and brand colors for the eventual web UI.
//
// FCS identity rows created by pullGames.ts are not in /teams/fbs,
// so they stay null. We don't rate or route-plan them anyway.
//
// Safe to re-run. Run:  npm run backfill-team-meta
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const ESPN_TEAMS =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=900";

const prisma = new PrismaClient();

interface CfbdTeam {
  school: string;
  abbreviation: string | null;
  color: string | null;
  alternateColor: string | null;
  logos: string[] | null;
  location: {
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
    elevation: string | number | null;
  } | null;
}

async function main() {
  const teams = await buildTeamResolver(prisma, "cfbd");
  const cfbd = await cfbdGet<CfbdTeam[]>("/teams/fbs");
  console.log(`CFBD returned ${cfbd.length} FBS teams.\n`);

  let updated = 0;
  let noLocation = 0;
  const unresolved: string[] = [];

  for (const t of cfbd) {
    const teamId = teams.resolve(t.school);
    if (!teamId) {
      unresolved.push(t.school);
      continue;
    }

    const loc = t.location;
    if (!loc || loc.latitude == null || loc.longitude == null) noLocation++;

    const elevationM =
      loc?.elevation != null && loc.elevation !== ""
        ? Number(loc.elevation)
        : null;

    // logos[]: [light 500, dark 500, light 256, dark 256, ...]
    const logoLight = t.logos?.find((u) => u.includes("/logos/")) ?? null;
    const logoDark = t.logos?.find((u) => u.includes("/logos-dark/")) ?? null;

    await prisma.team.update({
      where: { id: teamId },
      data: {
        abbreviation: t.abbreviation ?? undefined,
        lat: loc?.latitude ?? undefined,
        lng: loc?.longitude ?? undefined,
        timezone: loc?.timezone ?? undefined,
        elevationM: Number.isFinite(elevationM as number) ? elevationM : undefined,
        logoLight: logoLight ?? undefined,
        logoDark: logoDark ?? undefined,
        color: t.color ?? undefined,
        altColor: t.alternateColor ?? undefined,
      },
    });
    updated++;
  }

  // --- abbreviations for every team, FCS opponents included (cheap, /teams
  //     returns all divisions) — used in tight UI spots like the spread cell ---
  const allCfbd = await cfbdGet<CfbdTeam[]>("/teams");
  let abbrSet = 0;
  for (const t of allCfbd) {
    if (!t.abbreviation) continue;
    const teamId = teams.resolve(t.school);
    if (!teamId) continue;
    await prisma.team.update({
      where: { id: teamId },
      data: { abbreviation: t.abbreviation },
    });
    abbrSet++;
  }
  console.log(`Abbreviations set (all divisions): ${abbrSet}\n`);

  // --- ESPN team ids (for the injuries feed) ---
  const espnResolver = await buildTeamResolver(prisma, "espn");
  const espnRes = await fetch(ESPN_TEAMS);
  const espnJson: any = await espnRes.json();
  const espnTeams: any[] = espnJson.sports?.[0]?.leagues?.[0]?.teams ?? [];
  let espnMatched = 0;
  for (const et of espnTeams) {
    const t = et.team;
    const teamId = espnResolver.resolve(t.displayName);
    if (!teamId) continue;
    await prisma.team.update({
      where: { id: teamId },
      data: { espnId: Number(t.id) },
    });
    espnMatched++;
  }

  console.log("============================================================");
  console.log(`Teams updated (CFBD):     ${updated}`);
  console.log(`  ...missing coordinates: ${noLocation}`);
  console.log(`ESPN ids matched:         ${espnMatched}`);
  console.log("============================================================\n");

  if (unresolved.length > 0) {
    console.log(`CFBD names that didn't resolve (${unresolved.length}): ${unresolved.join(", ")}`);
  }

  const stillNull = await prisma.team.count({
    where: { classification: "fbs", OR: [{ lat: null }, { lng: null }, { timezone: null }] },
  });
  console.log(
    stillNull === 0
      ? "Every FBS team now has home coordinates + timezone. Travel flag is unblocked."
      : `>> ${stillNull} FBS team(s) still missing lat/lng/timezone — check the list above.`
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
