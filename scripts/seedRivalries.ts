// ============================================================
// Seed the Rivalry table  (situational-flags prerequisite)
// ============================================================
// Wipes and re-inserts from data/rivalries.ts. Nothing references
// Rivalry.id, so a clean replace is the simplest correct approach —
// edit the data file, re-run.
//
// Validates every team name against Team.canonicalName and refuses
// to seed if any don't match (a silent typo would drop a rivalry).
//
// Run:  npm run seed-rivalries
// ============================================================

import { PrismaClient } from "@prisma/client";
import { RIVALRIES } from "../data/rivalries";

const prisma = new PrismaClient();

async function main() {
  const teams = await prisma.team.findMany({
    select: { id: true, canonicalName: true },
  });
  const idByName = new Map(teams.map((t) => [t.canonicalName, t.id]));

  const bad: string[] = [];
  for (const r of RIVALRIES) {
    if (!idByName.has(r.a)) bad.push(`${r.a}  (in "${r.name}")`);
    if (!idByName.has(r.b)) bad.push(`${r.b}  (in "${r.name}")`);
  }
  if (bad.length > 0) {
    console.error("These rivalry team names don't match any Team.canonicalName:\n");
    for (const b of bad) console.error(`  ${b}`);
    console.error("\nFix data/rivalries.ts and re-run. Nothing was changed.");
    process.exit(1);
  }

  // Normalize each pair so (A,B) and (B,A) can't both be stored.
  const seen = new Set<string>();
  const rows: { teamAId: string; teamBId: string; name: string }[] = [];
  for (const r of RIVALRIES) {
    const [a, b] = [r.a, r.b].sort();
    const key = `${a}|${b}`;
    if (seen.has(key)) {
      console.warn(`Duplicate pair skipped: ${r.a} / ${r.b}`);
      continue;
    }
    seen.add(key);
    rows.push({ teamAId: idByName.get(a)!, teamBId: idByName.get(b)!, name: r.name });
  }

  const deleted = await prisma.rivalry.deleteMany({});
  await prisma.rivalry.createMany({ data: rows });

  console.log(
    `Rivalry table: removed ${deleted.count}, inserted ${rows.length} pairs.`
  );

  // quick sanity: how many distinct FBS teams have at least one rivalry
  const withRivalry = new Set(rows.flatMap((r) => [r.teamAId, r.teamBId]));
  const fbsCount = await prisma.team.count({ where: { classification: "fbs" } });
  console.log(
    `${withRivalry.size} of ${fbsCount} FBS teams have at least one rivalry entry.`
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
