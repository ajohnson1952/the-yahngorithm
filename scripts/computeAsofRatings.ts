// ============================================================
// Point-in-time opponent-adjusted margin ratings
// ============================================================
// CFBD's SP+ endpoint only serves the FINAL rating, so it can't be
// used for an honest backtest. This builds our own: for every
// (season, throughWeek) a ridge-adjusted scoring-margin rating using
// ONLY games played by that week, shrunk toward a talent-based
// preseason prior.
//
//   minimize  Σ (margin_i − HFA_i − (r[home_i] − r[away_i]))²
//           + λ · Σ (r[t] − prior[t])²
//
//   prior[t] = TALENT_SCALE · z(talent composite)   (FCS → FCS_PRIOR)
//   HFA_i    = 0 at neutral sites, else FLAT_HFA
//
// λ makes the prior worth ~4 games, so early-season ratings sit near
// the prior and converge on results as the season plays out. This is
// essentially a point-in-time SRS with a recruiting prior.
//
// Writes TeamRatingAsOf for every (team, season, throughWeek 0..15).
//
// Run:  npm run compute-asof-ratings
//       npm run compute-asof-ratings -- --seasons 2023,2024,2025
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { seasonForDate } from "../lib/cfbd";

const prisma = new PrismaClient();

const LAMBDA = 4; // ridge strength ≈ prior worth 4 games
const TALENT_SCALE = 13; // 1 SD of talent → 13 pts of prior rating
const FCS_PRIOR = -18; // teams with no talent number (FCS opponents)
const FLAT_HFA = 2.7;
const MAX_WEEK = 15;

function parseArgs(): { seasons: number[] } {
  const args = process.argv.slice(2);
  const i = args.indexOf("--seasons");
  if (i >= 0 && args[i + 1]) {
    return { seasons: args[i + 1].split(",").map((s) => Number(s.trim())).filter(Number.isInteger) };
  }
  const cur = seasonForDate();
  // completed seasons we have games + factors for (2020 excluded upstream)
  return { seasons: [cur - 8, cur - 7, cur - 5, cur - 4, cur - 3, cur - 2, cur - 1, cur] };
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function stdev(a: number[]): number {
  if (a.length < 2) return 1;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1;
}

/** Solve A x = b for a symmetric positive-definite A (in place). */
function solveSPD(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Cholesky: A = L Lᵀ
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(s, 1e-9));
      else L[i][j] = s / L[j][j];
    }
  }
  // forward: L y = b
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  // back: Lᵀ x = y
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

interface GameLite {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  neutralSite: boolean;
}

async function main() {
  const { seasons } = parseArgs();
  console.log(`As-of ratings — seasons ${seasons.join(", ")}  (λ=${LAMBDA})\n`);

  const fbsIds = new Set(
    (await prisma.team.findMany({ where: { classification: "fbs" }, select: { id: true } })).map((t) => t.id)
  );

  const allRows: Prisma.TeamRatingAsOfCreateManyInput[] = [];

  for (const season of seasons) {
    const [games, talent] = await Promise.all([
      prisma.game.findMany({
        where: { season, status: "final", homeScore: { not: null }, awayScore: { not: null } },
        select: { week: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true, neutralSite: true },
        orderBy: { week: "asc" },
      }),
      prisma.teamTalent.findMany({ where: { season }, select: { teamId: true, talent: true } }),
    ]);
    if (games.length === 0) {
      console.log(`  ${season}: no games, skipped`);
      continue;
    }

    // talent prior (z-scored over teams that have a number)
    const talVals = talent.map((t) => t.talent);
    const tMean = mean(talVals);
    const tSd = stdev(talVals);
    const talById = new Map(talent.map((t) => [t.teamId, t.talent]));
    const priorOf = (id: string) => {
      const t = talById.get(id);
      if (t == null) return FCS_PRIOR;
      return TALENT_SCALE * ((t - tMean) / tSd);
    };

    // every team that plays this season
    const teamIds = [...new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId]))];
    const idx = new Map(teamIds.map((id, i) => [id, i]));
    const n = teamIds.length;
    const priors = teamIds.map(priorOf);

    for (let through = 0; through <= MAX_WEEK; through++) {
      const used = (games as GameLite[]).filter((g) => g.week <= through && g.week >= 1);

      let ratings: number[];
      if (used.length === 0) {
        ratings = priors.slice();
      } else {
        // normal equations: (XᵀX + λI) r = Xᵀy + λ·prior
        const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
        const b = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          A[i][i] = LAMBDA;
          b[i] = LAMBDA * priors[i];
        }
        for (const g of used) {
          const h = idx.get(g.homeTeamId)!;
          const a = idx.get(g.awayTeamId)!;
          const y = g.homeScore - g.awayScore - (g.neutralSite ? 0 : FLAT_HFA);
          A[h][h] += 1;
          A[a][a] += 1;
          A[h][a] -= 1;
          A[a][h] -= 1;
          b[h] += y;
          b[a] -= y;
        }
        ratings = solveSPD(A, b);
      }

      // centre on the FBS mean so "0 = average FBS team"
      const fbsRatings = teamIds.map((id, i) => (fbsIds.has(id) ? ratings[i] : null)).filter((x): x is number => x != null);
      const c = mean(fbsRatings);

      const gamesByTeam = new Map<string, number>();
      for (const g of used) {
        gamesByTeam.set(g.homeTeamId, (gamesByTeam.get(g.homeTeamId) ?? 0) + 1);
        gamesByTeam.set(g.awayTeamId, (gamesByTeam.get(g.awayTeamId) ?? 0) + 1);
      }

      for (let i = 0; i < n; i++) {
        if (!fbsIds.has(teamIds[i])) continue; // only store FBS ratings
        allRows.push({
          teamId: teamIds[i],
          season,
          throughWeek: through,
          rating: Math.round((ratings[i] - c) * 100) / 100,
          gamesUsed: gamesByTeam.get(teamIds[i]) ?? 0,
        });
      }
    }

    // quick sanity: top 5 at end of season
    const finalRows = allRows
      .filter((r) => r.season === season && r.throughWeek === MAX_WEEK)
      .sort((a, b) => b.rating - a.rating);
    const names = new Map(
      (await prisma.team.findMany({ where: { id: { in: finalRows.slice(0, 5).map((r) => r.teamId) } }, select: { id: true, canonicalName: true } })).map((t) => [t.id, t.canonicalName])
    );
    console.log(
      `  ${season}: ${games.length} games, ${teamIds.length} teams → top5 ` +
        finalRows.slice(0, 5).map((r) => `${names.get(r.teamId)} ${r.rating.toFixed(1)}`).join(", ")
    );
  }

  // write
  const seasonsWritten = [...new Set(allRows.map((r) => r.season))];
  await prisma.$transaction([
    prisma.teamRatingAsOf.deleteMany({ where: { season: { in: seasonsWritten } } }),
    ...chunk(allRows, 5000).map((c) => prisma.teamRatingAsOf.createMany({ data: c })),
  ]);

  console.log(`\nTeamRatingAsOf rows written: ${allRows.length}`);
  await prisma.$disconnect();
}

function chunk<T>(a: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
