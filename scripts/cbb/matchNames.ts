// npm run cbb:match-names [-- --kenpom path/to/names.txt]
//
// Collects the team names each outside source uses right now and reports
// which ones we can't match yet:
//   - odds_api: The Odds API's NCAAB event list (FREE — 0 credits)
//   - kenpom:   optional text file of KenPom names, one per line (from a
//               paste — we never fetch kenpom.com ourselves)
// Names that already have an alias are skipped. New ones get a SUGGESTED
// alias ('needs_review') when the matcher finds a team, and are listed as
// unmatched otherwise. Nothing is used by the pipeline until confirmed at
// /cbb/admin/teams.

import { readFileSync } from "fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { buildCbbMatcher } from "../../lib/cbbNames";
import { requireOddsCbbKey } from "../../lib/oddsCbb";

const prisma = new PrismaClient();
const UNMATCHED_KEY = "cbbUnmatchedNames"; // Meta row read by /cbb/admin/teams

async function oddsNames(): Promise<string[]> {
  const res = await fetch(
    `https://api.the-odds-api.com/v4/sports/basketball_ncaab/events?apiKey=${requireOddsCbbKey()}`,
    { signal: AbortSignal.timeout(20_000) }
  );
  if (!res.ok) throw new Error(`Odds API events -> ${res.status}`);
  const events = (await res.json()) as { home_team: string; away_team: string }[];
  return [...new Set(events.flatMap((e) => [e.home_team, e.away_team]))];
}

function kenpomNames(): string[] {
  const i = process.argv.indexOf("--kenpom");
  if (i < 0) return [];
  return [
    ...new Set(
      readFileSync(process.argv[i + 1], "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

async function main() {
  const [teams, espnAliases, existing] = await Promise.all([
    prisma.cbbTeam.findMany({ select: { id: true, name: true } }),
    prisma.cbbTeamAlias.findMany({ where: { source: "espn" }, select: { teamId: true, alias: true } }),
    prisma.cbbTeamAlias.findMany({
      where: { source: { in: ["odds_api", "kenpom"] } },
      select: { source: true, alias: true },
    }),
  ]);
  const espnName = new Map(espnAliases.map((a) => [a.teamId, a.alias]));
  const suggest = buildCbbMatcher(teams.map((t) => ({ ...t, espnName: espnName.get(t.id) ?? null })));
  const known = new Set(existing.map((a) => `${a.source}|${a.alias}`));

  // Hand-checked names (data/cbb/manualAliases.json) win over the matcher.
  const manual = JSON.parse(readFileSync("data/cbb/manualAliases.json", "utf8")) as Record<
    string,
    Record<string, string>
  >;
  const idByName = new Map(teams.map((t) => [t.name, t.id]));
  const manualHit = (source: string, n: string) => {
    const target = manual[source]?.[n];
    if (!target) return null;
    const id = idByName.get(target);
    if (!id) throw new Error(`manualAliases.json: no CbbTeam named "${target}" (for ${source} "${n}")`);
    return id;
  };

  const sources: [string, string[]][] = [
    ["odds_api", await oddsNames()],
    ["kenpom", kenpomNames()],
  ];

  for (const [source, names] of sources) {
    if (names.length === 0) continue;
    const fresh = names.filter((n) => !known.has(`${source}|${n}`));
    const unmatched: string[] = [];
    let suggested = 0;
    for (const n of fresh) {
      const handId = manualHit(source, n);
      if (handId) {
        await prisma.cbbTeamAlias.create({
          data: { source, alias: n, teamId: handId, confidence: "needs_review" },
        });
        suggested++;
        continue;
      }
      const s = suggest(n);
      if (!s.teamId) {
        unmatched.push(n);
        continue;
      }
      await prisma.cbbTeamAlias.create({
        data: { source, alias: n, teamId: s.teamId, confidence: "needs_review" },
      });
      suggested++;
      if (s.ambiguous) {
        console.log(`  ? ${source}: "${n}" -> ${s.teamName}  (AMBIGUOUS — check this one)`);
      }
    }
    console.log(
      `${source}: ${names.length} names, ${names.length - fresh.length} already known, ` +
        `${suggested} new suggestions, ${unmatched.length} unmatched`
    );
    for (const n of unmatched.sort()) console.log(`  ✗ ${n}`);

    // Keep this source's unmatched list for /cbb/admin/teams (replaced each run).
    const prev = await prisma.meta.findUnique({ where: { key: UNMATCHED_KEY } });
    const value: Prisma.InputJsonObject = { ...((prev?.value as Prisma.InputJsonObject) ?? {}), [source]: { names: unmatched, at: new Date().toISOString() } };
    await prisma.meta.upsert({ where: { key: UNMATCHED_KEY }, update: { value }, create: { key: UNMATCHED_KEY, value } });
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
