// ============================================================
// Advanced team stats + EPA  (Yahn model v2 — efficiency factors)
// ============================================================
// CFBD /stats/season/advanced  (success rate, explosiveness, havoc,
//   points per scoring opportunity, field position) merged with
// CFBD /ppa/teams  (EPA per play, offense & defense).
//
// These are the raw "Five Factors" ingredients. NOT opponent-adjusted
// here — SP+ is our opponent-adjusted backbone; these ride alongside
// it for the ensemble and for the game-page breakdown.
//
// Snapshotted per (team, season, week) as a "season to date through
// week N" view. 2 CFBD calls.
//
// Run:  npm run pull-advanced
//       npm run pull-advanced -- --season 2026 --week 5
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet, getCurrentSeasonWeek } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface AdvSide {
  successRate?: number | null;
  explosiveness?: number | null;
  pointsPerOpportunity?: number | null;
  havoc?: { total?: number | null } | null;
  fieldPosition?: { averagePredictedPoints?: number | null } | null;
}
interface AdvRow {
  season: number;
  team: string;
  offense?: AdvSide | null;
  defense?: AdvSide | null;
}
interface PpaRow {
  season: number;
  team: string;
  offense?: { overall?: number | null } | null;
  defense?: { overall?: number | null } | null;
}

function parseArgs(): { season?: number; week?: number } {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined;
  };
  const season = val("--season");
  const week = val("--week");
  if ((season && !week) || (!season && week)) {
    console.error("Pass --season AND --week together, or neither. Stopping.");
    process.exit(1);
  }
  return { season, week };
}

const n = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

async function main() {
  const o = parseArgs();
  const { season, week } =
    o.season != null && o.week != null
      ? { season: o.season, week: o.week }
      : await getCurrentSeasonWeek();

  console.log(`Advanced stats + EPA — season ${season}, through week ${week}\n`);

  const teams = await buildTeamResolver(prisma, "cfbd");
  const [adv, ppa] = await Promise.all([
    cfbdGet<AdvRow[]>(`/stats/season/advanced?year=${season}`),
    cfbdGet<PpaRow[]>(`/ppa/teams?year=${season}`),
  ]);
  console.log(`  -> advanced rows: ${adv.length}, ppa rows: ${ppa.length}`);

  if (adv.length === 0 && ppa.length === 0) {
    console.log("\nNo advanced data yet — normal before any games are played. Nothing written.");
    await prisma.$disconnect();
    return;
  }

  const ppaByTeam = new Map(ppa.map((r) => [r.team, r]));
  const unmatched: string[] = [];
  let wrote = 0;

  for (const r of adv) {
    if (!r.team) continue;
    const teamId = teams.resolve(r.team);
    if (!teamId) {
      unmatched.push(r.team);
      continue;
    }
    const p = ppaByTeam.get(r.team);
    const data = {
      offSuccess: n(r.offense?.successRate),
      defSuccess: n(r.defense?.successRate),
      offExplosive: n(r.offense?.explosiveness),
      defExplosive: n(r.defense?.explosiveness),
      offPPO: n(r.offense?.pointsPerOpportunity),
      defPPO: n(r.defense?.pointsPerOpportunity),
      offHavoc: n(r.offense?.havoc?.total),
      defHavoc: n(r.defense?.havoc?.total),
      offFieldPos: n(r.offense?.fieldPosition?.averagePredictedPoints),
      defFieldPos: n(r.defense?.fieldPosition?.averagePredictedPoints),
      offPPA: n(p?.offense?.overall),
      defPPA: n(p?.defense?.overall),
    };
    await prisma.teamAdvancedWeekly.upsert({
      where: { teamId_season_week: { teamId, season, week } },
      update: { ...data, pulledAt: new Date() },
      create: { teamId, season, week, ...data },
    });
    wrote++;
  }

  console.log("\n============================================================");
  console.log(`TeamAdvancedWeekly rows upserted: ${wrote}  (season ${season}, week ${week})`);
  if (unmatched.length) {
    console.log(
      `Unmatched team names (${unmatched.length}): ${unmatched.slice(0, 20).join(", ")}`
    );
  }
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
