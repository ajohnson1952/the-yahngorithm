// ============================================================
// Returning production  (Yahn model v2 — roster stability factor)
// ============================================================
// CFBD /player/returning — the share of last season's production
// (measured in PPA) coming back this year. percentPPA is the headline
// "continuity / stability" number Connelly uses in SP+'s preseason
// projection. High = experienced, known quantity; low = boom/bust.
//
// 1 CFBD call. Upserts TeamReturningProduction (teamId, season).
//
// Run:  npm run pull-returning
//       npm run pull-returning -- --season 2026
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet, seasonForDate } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface ReturningRow {
  season: number;
  team: string;
  percentPPA?: number | null;
  percentPassingPPA?: number | null;
  percentReceivingPPA?: number | null;
  percentRushingPPA?: number | null;
  totalPPA?: number | null;
  usage?: number | null;
}

function parseArgs(): { season?: number } {
  const args = process.argv.slice(2);
  const i = args.indexOf("--season");
  return { season: i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined };
}

const n = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

async function main() {
  const season = parseArgs().season ?? seasonForDate();
  console.log(`Returning production — season ${season}\n`);

  const teams = await buildTeamResolver(prisma, "cfbd");
  const rows = await cfbdGet<ReturningRow[]>(`/player/returning?year=${season}`);
  console.log(`  -> ${rows.length} returning-production rows from CFBD`);

  const unmatched: string[] = [];
  let wrote = 0;

  for (const r of rows) {
    if (!r.team) continue;
    const teamId = teams.resolve(r.team);
    if (!teamId) {
      unmatched.push(r.team);
      continue;
    }
    const data = {
      percentPPA: n(r.percentPPA),
      percentPassingPPA: n(r.percentPassingPPA),
      percentReceivingPPA: n(r.percentReceivingPPA),
      percentRushingPPA: n(r.percentRushingPPA),
      totalPPA: n(r.totalPPA),
      usage: n(r.usage),
    };
    await prisma.teamReturningProduction.upsert({
      where: { teamId_season: { teamId, season } },
      update: { ...data, pulledAt: new Date() },
      create: { teamId, season, ...data },
    });
    wrote++;
  }

  console.log("\n============================================================");
  console.log(`TeamReturningProduction rows upserted: ${wrote}`);
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
