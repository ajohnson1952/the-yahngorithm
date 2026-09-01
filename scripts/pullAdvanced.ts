// ============================================================
// Advanced team stats + EPA  (Yahn model v2 — efficiency factors)
// ============================================================
// CFBD /stats/season/advanced — success rate, explosiveness, havoc,
// points per scoring opportunity, field position, AND per-play PPA
// (= EPA). NOT opponent-adjusted here; SP+ is our adjusted backbone,
// these ride alongside for the ensemble + the game-page breakdown.
//
// Snapshotted per (team, season, week) as a "season to date through
// week N" view. `--through N` sets the API's endWeek so historical
// backfill gets point-in-time cumulative stats. 1 CFBD call.
//
// Run:  npm run pull-advanced                         (auto week, full season to date)
//       npm run pull-advanced -- --season 2026 --week 5
//       npm run pull-advanced -- --season 2023 --through 8   (backfill: stats thru wk 8)
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet, getCurrentSeasonWeek, getCfbdCallCount } from "../lib/cfbd";
import { recordCfbdUsage } from "../lib/apiUsage";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface AdvSide {
  successRate?: number | null;
  explosiveness?: number | null;
  ppa?: number | null;
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

function parseArgs(): { season?: number; week?: number; through?: number } {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined;
  };
  const season = val("--season");
  const week = val("--week");
  const through = val("--through");
  if (through != null && season == null) {
    console.error("--through needs --season. Stopping.");
    process.exit(1);
  }
  if (through == null && (season && !week) || (!season && week)) {
    console.error("Pass --season AND --week together, or --season --through N, or neither.");
    process.exit(1);
  }
  return { season, week, through };
}

const n = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

async function main() {
  const o = parseArgs();
  let season: number, week: number, endWeek: number | null;
  if (o.season != null && o.through != null) {
    season = o.season;
    week = o.through;
    endWeek = o.through;
  } else if (o.season != null && o.week != null) {
    season = o.season;
    week = o.week;
    endWeek = null;
  } else {
    const cur = await getCurrentSeasonWeek();
    season = cur.season;
    week = cur.week;
    endWeek = null;
  }

  console.log(
    `Advanced stats + EPA — season ${season}, through week ${week}` +
      (endWeek ? ` (API endWeek=${endWeek})` : "") + "\n"
  );

  const teams = await buildTeamResolver(prisma, "cfbd");
  const path = endWeek
    ? `/stats/season/advanced?year=${season}&startWeek=1&endWeek=${endWeek}`
    : `/stats/season/advanced?year=${season}`;
  const adv = await cfbdGet<AdvRow[]>(path);
  console.log(`  -> advanced rows: ${adv.length}`);

  if (adv.length === 0) {
    console.log("\nNo advanced data — normal before any games are played. Nothing written.");
        await recordCfbdUsage(prisma, getCfbdCallCount());
await prisma.$disconnect();
    return;
  }

  const unmatched: string[] = [];
  let wrote = 0;

  for (const r of adv) {
    if (!r.team) continue;
    const teamId = teams.resolve(r.team);
    if (!teamId) {
      unmatched.push(r.team);
      continue;
    }
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
      offPPA: n(r.offense?.ppa),
      defPPA: n(r.defense?.ppa),
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
    console.log(`Unmatched (${unmatched.length}): ${unmatched.slice(0, 20).join(", ")}`);
  }
  console.log("============================================================");

  await recordCfbdUsage(prisma, getCfbdCallCount());
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
