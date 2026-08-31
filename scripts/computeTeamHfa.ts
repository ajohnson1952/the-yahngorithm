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

// Per-team samples are tiny (~15-20 home games over 3 seasons) and the
// TRUE spread of per-team HFA is small — the literature says almost every
// program sits within ~1 pt of the league mean, with altitude and a few
// genuinely hostile venues the only reliable outliers. So we regress very
// hard toward the league mean (computed from the data, not assumed): a
// team's own record gets only ~n/(n+PRIOR_N) ≈ 11% of the weight.
const PRIOR_N = 150; // "phantom games" at the league mean
const HFA_MIN = 2.2;
const HFA_MAX = 4.0;
const PRIOR_FALLBACK = 2.8; // used only if the sample is tiny/degenerate

// NOTE (v1): baseline is end-of-season SP+ (all we store historically).
// Fine for a residual averaged over many games. Revisit in the calibration
// pass with more seasons loaded and/or as-of-week ratings.

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
        select: { id: true, canonicalName: true, classification: true },
      })
    ).map((t) => [t.id, { name: t.canonicalName, cls: t.classification }])
  );
  const sorted = [...rows]
    .filter((r) => nameById.get(r.teamId)?.cls === "fbs")
    .sort((a, b) => b.hfa - a.hfa);

  const hist: Record<string, number> = {};
  for (const r of sorted) {
    const b = (Math.floor(r.hfa * 4) / 4).toFixed(2);
    hist[b] = (hist[b] ?? 0) + 1;
  }

  console.log("\n============================================================");
  console.log(`Games used: ${allResiduals.length}   league mean residual: ${leagueMean.toFixed(2)}`);
  console.log(`TeamHfa rows written: ${rows.length}  (prior ${prior.toFixed(2)} @ n=${PRIOR_N}, clamp ${HFA_MIN}-${HFA_MAX})`);
  console.log(`\nDistribution (FBS): ${JSON.stringify(hist)}`);
  console.log("\n  Full FBS list, strongest home field first:\n");
  const col = (r: (typeof sorted)[number]) =>
    `    ${(nameById.get(r.teamId)?.name ?? r.teamId).padEnd(24)} ${r.hfa.toFixed(2)}  (n=${r.sampleSize})`;
  for (const r of sorted) console.log(col(r));
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
