// ============================================================
// Per-team home-field advantage  (Yahn model v2 — venue factor)
// ============================================================
// SP+ (and our model today) applies a flat 2.5-pt HFA. Real HFA
// varies: altitude, travel burden on visitors, crowd, unusual
// environments (academies, Hawai'i, a few hostile SEC venues).
//
// Method: for every completed non-neutral game in the last few
// seasons, residual = actual home margin − (SP+_home − SP+_away).
// Average per home team, then regress hard toward the league prior
// (small per-team samples). Clamp to a sane band.
//
// ~3 CFBD calls (historical SP+). Rewrites TeamHfa.
//
// Run:  npm run compute-team-hfa
//       npm run compute-team-hfa -- --seasons 2022,2023,2024,2025
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { cfbdGet, seasonForDate } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

// Per-team samples are small (~15-20 home games over 3 seasons), so we
// regress HARD toward the league mean — which we compute from the data
// itself rather than assume. Only a venue with a big, consistent,
// multi-season residual moves off the average by more than ~1 pt.
const PRIOR_N = 55; // "phantom games" at the league mean
const HFA_MIN = 1.5; // true per-team HFA spread is small; clamp the noise
const HFA_MAX = 4.0;
const PRIOR_FALLBACK = 2.6; // used only if the sample is tiny/degenerate

// NOTE (v1): uses end-of-season SP+ as the baseline (that's all we store
// historically). Fine for a residual averaged over many games, but the
// per-team numbers still carry small-sample noise — teams sitting on the
// clamp are being pinned by variance, not a proven home edge. Revisit in
// the calibration pass with more seasons and/or as-of-week ratings.

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
      seasons: args[i + 1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n)),
    };
  }
  const cur = seasonForDate();
  return { seasons: [cur - 3, cur - 2, cur - 1] };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

async function main() {
  const { seasons } = parseArgs();
  console.log(`Per-team HFA — residuals over SP+ across ${seasons.join(", ")}\n`);

  const teams = await buildTeamResolver(prisma, "cfbd");

  // historical SP+ overall rating: teamId -> season -> rating
  const spById = new Map<string, Map<number, number>>();
  for (const yr of seasons) {
    const rows = await cfbdGet<SpRow[]>(`/ratings/sp?year=${yr}`);
    for (const r of rows) {
      if (!r.team || r.team === "nationalAverages" || r.rating == null) continue;
      const id = teams.resolve(r.team);
      if (!id) continue;
      let m = spById.get(id);
      if (!m) spById.set(id, (m = new Map()));
      m.set(yr, r.rating);
    }
    console.log(`  SP+ ${yr}: ${rows.length} rows`);
  }

  const games = await prisma.game.findMany({
    where: {
      season: { in: seasons },
      neutralSite: false,
      status: "final",
      homeScore: { not: null },
      awayScore: { not: null },
    },
    select: {
      season: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  });

  const acc = new Map<string, { sum: number; n: number }>();
  const allResiduals: number[] = [];
  for (const g of games) {
    const spH = spById.get(g.homeTeamId)?.get(g.season);
    const spA = spById.get(g.awayTeamId)?.get(g.season);
    if (spH == null || spA == null) continue;
    const resid = g.homeScore! - g.awayScore! - (spH - spA);
    allResiduals.push(resid);
    const a = acc.get(g.homeTeamId) ?? { sum: 0, n: 0 };
    a.sum += resid;
    a.n++;
    acc.set(g.homeTeamId, a);
  }

  const leagueMean = allResiduals.length
    ? allResiduals.reduce((x, y) => x + y, 0) / allResiduals.length
    : PRIOR_FALLBACK;
  const prior = clamp(leagueMean, 1.8, 3.4);

  const rows: Prisma.TeamHfaCreateManyInput[] = [];
  for (const [teamId, a] of acc) {
    const hfa = clamp((a.sum + PRIOR_N * prior) / (a.n + PRIOR_N), HFA_MIN, HFA_MAX);
    rows.push({ teamId, hfa: Math.round(hfa * 100) / 100, sampleSize: a.n });
  }

  await prisma.$transaction([
    prisma.teamHfa.deleteMany({}),
    prisma.teamHfa.createMany({ data: rows }),
  ]);

  const nameById = new Map(
    (
      await prisma.team.findMany({
        where: { id: { in: rows.map((r) => r.teamId) } },
        select: { id: true, canonicalName: true },
      })
    ).map((t) => [t.id, t.canonicalName])
  );
  const sorted = [...rows].sort((a, b) => b.hfa - a.hfa);

  console.log("\n============================================================");
  console.log(`Games used: ${allResiduals.length}   league mean residual: ${leagueMean.toFixed(2)}`);
  console.log(`TeamHfa rows written: ${rows.length}  (prior ${prior.toFixed(2)} @ n=${PRIOR_N})`);
  console.log("\n  Strongest home fields:");
  for (const r of sorted.slice(0, 8))
    console.log(`    ${(nameById.get(r.teamId) ?? r.teamId).padEnd(22)} ${r.hfa.toFixed(2)}  (n=${r.sampleSize})`);
  console.log("  Weakest:");
  for (const r of sorted.slice(-6).reverse())
    console.log(`    ${(nameById.get(r.teamId) ?? r.teamId).padEnd(22)} ${r.hfa.toFixed(2)}  (n=${r.sampleSize})`);
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
