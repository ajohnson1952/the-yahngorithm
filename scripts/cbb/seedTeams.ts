// npm run cbb:seed-teams
//
// Loads the D-I team list from CollegeBasketballData (ONE call — it shares
// the CFBD key's 1,000/month quota, so this is not run on a schedule; rerun
// only when the D-I list changes, e.g. each fall). Safe to rerun: upserts by
// CBBD id. Also writes each team's CBBD and ESPN names as confirmed aliases
// (both come from the same record, so they're exact, not guesses).

import { PrismaClient } from "@prisma/client";
import { cfbdGet, getCfbdCallCount } from "../../lib/cfbd";
import { recordCfbdUsage } from "../../lib/apiUsage";
import { cbbSeason } from "../../lib/espnCbb";

interface CbbdTeam {
  id: number;
  sourceId: string | null; // ESPN team id
  school: string;
  displayName: string | null; // ESPN-style "Siena Saints"
  abbreviation: string | null;
  conference: string | null;
  primaryColor: string | null;
  logos: string[] | null;
}

const prisma = new PrismaClient();

async function main() {
  const season = Number(process.argv[2]) || cbbSeason();
  const teams = await cfbdGet<CbbdTeam[]>(
    `https://api.collegebasketballdata.com/teams?season=${season}`
  );
  const d1 = teams.filter((t) => t.conference); // D-I teams all have a conference
  console.log(`CBBD: ${teams.length} teams for ${season}, ${d1.length} with a conference.`);

  let n = 0;
  for (const t of d1) {
    const espnId = t.sourceId ? Number(t.sourceId) : null;
    const data = {
      name: t.school,
      division: "d1",
      espnId,
      conference: t.conference,
      abbreviation: t.abbreviation,
      logo: t.logos?.[0] ?? null,
      color: t.primaryColor,
    };
    // An ESPN-created non-D-I row may already hold this espnId (a school that
    // moved up) — promote that row instead of colliding with it.
    const existing =
      (await prisma.cbbTeam.findUnique({ where: { cbbdId: t.id } })) ??
      (espnId != null ? await prisma.cbbTeam.findUnique({ where: { espnId } }) : null);
    const team = existing
      ? await prisma.cbbTeam.update({ where: { id: existing.id }, data: { ...data, cbbdId: t.id } })
      : await prisma.cbbTeam.create({ data: { ...data, cbbdId: t.id } });

    const aliases: { source: string; alias: string }[] = [{ source: "cbbd", alias: t.school }];
    if (t.displayName) aliases.push({ source: "espn", alias: t.displayName });
    for (const a of aliases) {
      await prisma.cbbTeamAlias.upsert({
        where: { source_alias: a },
        update: { teamId: team.id, confidence: "confirmed" },
        create: { ...a, teamId: team.id, confidence: "confirmed" },
      });
    }
    n++;
  }
  console.log(`Upserted ${n} D-I teams (+ cbbd/espn aliases).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await recordCfbdUsage(prisma, getCfbdCallCount()).catch(() => {});
    await prisma.$disconnect();
  });
