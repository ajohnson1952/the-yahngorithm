// ============================================================
// Per-team home-field advantage  (Yahn model v2 — venue factor)
// ============================================================
// RULES-BASED. We tried deriving per-team HFA from history
// (home margin vs SP+ expectation, 7 seasons, with and without a
// home−road differential). It doesn't work at this sample size: the
// estimate is dominated by the "favorites underperform the number"
// effect, and the home team is almost always the favorite — so good
// programs come out with a fake *negative* HFA and cupcake-hosting
// bottom-feeders come out high. More data didn't fix it.
//
// What every serious study DOES agree on: reputation ("toughest place
// to play") tracks the scoreboard effect poorly, and the one robust
// venue factor is ALTITUDE. So:
//
//   HFA(team) = BASE  +  altitude bump (from Team.elevationM)
//
// The SP+-residual number is still computed and printed as a
// diagnostic (not stored) so we can sanity-check against it and
// revisit in the calibration pass (build 3), which can fit HFA
// jointly with team ratings and escape the favorite bias.
//
// ~7 CFBD calls (historical SP+, for the diagnostic only).
//
// Run:  npm run compute-team-hfa
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { cfbdGet, seasonForDate } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

const BASE_HFA = 2.7; // league-average home edge, modern CFB
// altitude bump: nothing below ~1100 m (excludes Boone/Lubbock-type mild
// elevation), ramping to ~+1.0 at Wyoming's ~2200 m
const ALT_FLOOR_M = 1100;
const ALT_CEIL_M = 2200;
const ALT_MAX_BUMP = 1.0;
const BLOWOUT_GAP = 21;

interface SpRow {
  year: number;
  team: string;
  rating: number | null;
}

function parseArgs(): { seasons: number[] } {
  const args = process.argv.slice(2);
  const i = args.indexOf("--seasons");
  if (i >= 0 && args[i + 1]) {
    return {
      seasons: args[i + 1].split(",").map((s) => Number(s.trim())).filter(Number.isInteger),
    };
  }
  const cur = seasonForDate();
  return { seasons: [cur - 8, cur - 7, cur - 5, cur - 4, cur - 3, cur - 2, cur - 1] };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function altitudeBump(elevationM: number | null): number {
  if (elevationM == null || elevationM <= ALT_FLOOR_M) return 0;
  const t = clamp((elevationM - ALT_FLOOR_M) / (ALT_CEIL_M - ALT_FLOOR_M), 0, 1);
  return Math.round(t ** 0.8 * ALT_MAX_BUMP * 100) / 100;
}

async function main() {
  const { seasons } = parseArgs();
  console.log(`Per-team HFA — rules-based (base ${BASE_HFA} + altitude)\n`);

  const teams = await prisma.team.findMany({
    where: { classification: "fbs" },
    select: { id: true, canonicalName: true, elevationM: true },
  });

  const rows: Prisma.TeamHfaCreateManyInput[] = teams.map((t) => ({
    teamId: t.id,
    hfa: Math.round((BASE_HFA + altitudeBump(t.elevationM)) * 100) / 100,
    sampleSize: 0,
  }));

  await prisma.$transaction([
    prisma.teamHfa.deleteMany({}),
    prisma.teamHfa.createMany({ data: rows }),
  ]);

  // ---- diagnostic: the SP+-residual estimate (NOT stored) ----
  const resolver = await buildTeamResolver(prisma, "cfbd");
  const spById = new Map<string, Map<number, number>>();
  for (const yr of seasons) {
    const sp = await cfbdGet<SpRow[]>(`/ratings/sp?year=${yr}`).catch(() => [] as SpRow[]);
    for (const r of sp) {
      if (!r.team || r.team === "nationalAverages" || r.rating == null) continue;
      const id = resolver.resolve(r.team);
      if (!id) continue;
      (spById.get(id) ?? spById.set(id, new Map()).get(id)!).set(yr, r.rating);
    }
  }
  const games = await prisma.game.findMany({
    where: {
      season: { in: seasons },
      neutralSite: false,
      status: "final",
      homeScore: { not: null },
      awayScore: { not: null },
    },
    select: { season: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const resid = new Map<string, number[]>();
  for (const g of games) {
    const spH = spById.get(g.homeTeamId)?.get(g.season);
    const spA = spById.get(g.awayTeamId)?.get(g.season);
    if (spH == null || spA == null || Math.abs(spH - spA) > BLOWOUT_GAP) continue;
    (resid.get(g.homeTeamId) ?? resid.set(g.homeTeamId, []).get(g.homeTeamId)!).push(
      g.homeScore! - g.awayScore! - (spH - spA)
    );
  }

  const nameById = new Map(teams.map((t) => [t.id, t.canonicalName]));
  const withAlt = rows
    .filter((r) => r.hfa > BASE_HFA)
    .sort((a, b) => b.hfa - a.hfa);

  console.log("============================================================");
  console.log(`TeamHfa rows written: ${rows.length}  (base ${BASE_HFA}, ${withAlt.length} altitude-adjusted)\n`);
  console.log("  Altitude-adjusted venues:");
  for (const r of withAlt) {
    const d = resid.get(r.teamId);
    console.log(
      `    ${(nameById.get(r.teamId) ?? "").padEnd(22)} ${r.hfa.toFixed(2)}   ` +
        `(SP+-residual diag: ${d && d.length >= 10 ? mean(d).toFixed(1) : "n/a"})`
    );
  }
  console.log(`\n  Everyone else: ${BASE_HFA.toFixed(2)}`);
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
