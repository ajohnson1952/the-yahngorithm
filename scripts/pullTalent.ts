// ============================================================
// Team talent composite  (Yahn model v2 — roster factor)
// ============================================================
// CFBD /talent — the 247Sports team talent composite (accumulated
// recruiting rankings). One number per team per season, published
// preseason and static through the year. An early-season prior for
// "how much raw ability is on this roster".
//
// 1 CFBD call. Upserts TeamTalent (teamId, season).
//
// Run:  npm run pull-talent
//       npm run pull-talent -- --season 2026
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet, seasonForDate } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface TalentRow {
  year: number;
  team: string;
  talent: number | string | null;
}

function parseArgs(): { season?: number } {
  const args = process.argv.slice(2);
  const i = args.indexOf("--season");
  return { season: i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined };
}

async function main() {
  const season = parseArgs().season ?? seasonForDate();
  console.log(`Team talent composite — season ${season}\n`);

  const teams = await buildTeamResolver(prisma, "cfbd");
  const rows = await cfbdGet<TalentRow[]>(`/talent?year=${season}`);
  console.log(`  -> ${rows.length} talent rows from CFBD`);

  const unmatched: string[] = [];
  let wrote = 0;

  for (const r of rows) {
    const talent = Number(r.talent);
    if (!r.team || !Number.isFinite(talent)) continue;
    const teamId = teams.resolve(r.team);
    if (!teamId) {
      unmatched.push(r.team);
      continue;
    }
    await prisma.teamTalent.upsert({
      where: { teamId_season: { teamId, season } },
      update: { talent, pulledAt: new Date() },
      create: { teamId, season, talent },
    });
    wrote++;
  }

  console.log("\n============================================================");
  console.log(`TeamTalent rows upserted: ${wrote}`);
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
