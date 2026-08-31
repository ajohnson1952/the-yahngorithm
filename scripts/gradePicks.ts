// ============================================================
// Grade picks  (PROJECT_BRIEF: "track record matters more than any
// single prediction")
// ============================================================
// For every logged Pick whose game is final and that isn't graded
// yet: record the actual result, the closing line, whether the pick
// won ATS, and compute closing-line value.
//
// CLV (points) = how much better our number was than the closing
// number, from our side. Positive CLV over time is the real evidence
// the process has an edge, even in a season where W-L is noisy.
//
// No API calls. Run after games finish (Sunday), or any time.
//
// Run:  npm run grade-picks
//       npm run grade-picks -- --season 2026 --week 3
// ============================================================

import { PrismaClient } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { median } from "../lib/consensus";

const prisma = new PrismaClient();

function parseArgs(): { season?: number; week?: number } {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const season = val("--season");
  const week = val("--week");
  if ((season && !week) || (!season && week)) {
    console.error("Pass --season AND --week together, or neither. Stopping.");
    process.exit(1);
  }
  return {
    season: season ? Number(season) : undefined,
    week: week ? Number(week) : undefined,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const signed = (n: number) => (n > 0 ? "+" : "") + r1(n);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** closing home-margin (spread) or total, from the 'close' snapshot if we have
 *  one, else the latest snapshot before kickoff. */
function closingConsensus(
  lines: { market: string; lineValue: number; snapshotType: string; capturedAt: Date }[],
  kickoff: Date,
  market: "spread" | "total"
): number | null {
  const m = lines.filter((l) => l.market === market);
  if (m.length === 0) return null;
  const close = m.filter((l) => l.snapshotType === "close");
  const pool = close.length > 0 ? close : m.filter((l) => l.capturedAt <= kickoff);
  const use = pool.length > 0 ? pool : m;
  const val = median(use.map((l) => l.lineValue));
  if (val == null) return null;
  return market === "spread" ? -val : val; // spread -> home margin
}

async function main() {
  const o = parseArgs();
  const { season, week } =
    o.season != null && o.week != null
      ? { season: o.season, week: o.week }
      : await getCurrentSeasonWeek();

  const picks = await prisma.pick.findMany({
    where: {
      gradedAt: null,
      game: { season, week, status: "final" },
    },
    include: {
      game: {
        include: {
          homeTeam: true,
          awayTeam: true,
          lines: {
            select: { market: true, lineValue: true, snapshotType: true, capturedAt: true },
          },
        },
      },
    },
  });

  console.log(`Grading — season ${season}, week ${week}: ${picks.length} ungraded final pick(s)\n`);

  let w = 0, l = 0, pu = 0;
  const clvs: number[] = [];

  for (const pick of picks) {
    const g = pick.game;
    if (g.homeScore == null || g.awayScore == null) continue;

    const backHome = pick.edge > 0; // spread: backed home; total: over
    const actual =
      pick.market === "spread"
        ? g.homeScore - g.awayScore
        : g.homeScore + g.awayScore;

    // ATS vs the line the pick was made at
    const diff = actual - pick.marketLine; // spread: home cover; total: over cover
    let atsResult: "win" | "loss" | "push";
    if (Math.abs(diff) < 1e-9) atsResult = "push";
    else if ((diff > 0) === backHome) atsResult = "win";
    else atsResult = "loss";

    // closing line + CLV
    const closing = closingConsensus(
      g.lines as any,
      g.kickoffTime,
      pick.market as "spread" | "total"
    );
    let clv: number | null = null;
    if (closing != null) {
      // positive = our number was more favorable to our side than the close
      clv = backHome ? closing - pick.marketLine : pick.marketLine - closing;
      clvs.push(clv);
    }

    await prisma.pick.update({
      where: { id: pick.id },
      data: {
        actualResult: actual,
        closingLine: closing,
        atsResult,
        gradedAt: new Date(),
      },
    });

    if (atsResult === "win") w++;
    else if (atsResult === "loss") l++;
    else pu++;

    const side =
      pick.market === "spread"
        ? backHome
          ? `${g.homeTeam.canonicalName} ${r1(-pick.marketLine)}`
          : `${g.awayTeam.canonicalName} +${r1(pick.marketLine)}`
        : `${backHome ? "OVER" : "UNDER"} ${r1(pick.marketLine)}`;
    console.log(
      `  ${atsResult.toUpperCase().padEnd(5)} ${pick.market} ${side.padEnd(24)} ` +
        `actual ${r1(actual)}  close ${closing == null ? "?" : r1(closing)}  ` +
        `CLV ${clv == null ? "?" : (clv > 0 ? "+" : "") + r1(clv)}`
    );
  }

  console.log("\n============================================================");
  console.log(`This run:  ${w}-${l}-${pu} ATS`);
  if (clvs.length > 0) {
    const beat = clvs.filter((x) => x > 0).length;
    console.log(`CLV:       ${beat}/${clvs.length} beat the close, avg ${signed(mean(clvs))} pts`);
  }

  // season to date
  const graded = await prisma.pick.findMany({
    where: { game: { season }, gradedAt: { not: null } },
    select: { atsResult: true, marketLine: true, closingLine: true, edge: true },
  });
  if (graded.length > 0) {
    const g = { win: 0, loss: 0, push: 0 } as Record<string, number>;
    const sclv: number[] = [];
    for (const p of graded) {
      if (p.atsResult) g[p.atsResult]++;
      if (p.closingLine != null) {
        const backHome = p.edge > 0;
        sclv.push(backHome ? p.closingLine - p.marketLine : p.marketLine - p.closingLine);
      }
    }
    console.log("------------------------------------------------------------");
    console.log(`Season ${season} to date:  ${g.win}-${g.loss}-${g.push} ATS`);
    if (sclv.length > 0) {
      const beat = sclv.filter((x) => x > 0).length;
      console.log(`CLV: ${beat}/${sclv.length} beat close, avg ${signed(mean(sclv))} pts`);
    }
  }
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
