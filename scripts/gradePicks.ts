// ============================================================
// Grade picks + every model + every flag
// ============================================================
// 1. For every logged Pick whose game is final and not yet graded:
//    actual result, closing line, ATS, and closing-line value (CLV).
// 2. For every final game with a closing line: grade all three spread
//    models AND every situational/market flag against that close, into
//    ModelGrade. This is the hindsight-free record — over the 2026
//    season it answers "does any of this actually beat the market?"
//
// No API calls. Run after games finish (Sunday), or any time.
//
// Run:  npm run grade-picks
//       npm run grade-picks -- --season 2026 --week 3
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { median } from "../lib/consensus";

const prisma = new PrismaClient();

// flag → which side its presence implies you bet
const FLAG_FADE = new Set(["short_week", "travel", "lookahead", "letdown", "bad_spot", "rlm"]);
const FLAG_BACK = new Set(["off_bye", "revenge", "steam"]);

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

/** Grade the 3 spread models + every flag on this week's final games,
 *  then print a season-to-date scoreboard. Idempotent (upsert per game+key). */
async function gradeModelsAndFlags(season: number, week: number) {
  // freeze the grade at first grading — don't re-score a game once it's in
  // (a later run-model on a final game would be mild hindsight).
  const already = new Set(
    (await prisma.modelGrade.findMany({ where: { season, week }, select: { gameId: true } })).map(
      (x) => x.gameId
    )
  );

  const games = await prisma.game.findMany({
    where: {
      season, week, status: "final",
      homeScore: { not: null }, awayScore: { not: null },
      id: { notIn: [...already] },
    },
    select: {
      id: true, kickoffTime: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true,
      lines: { select: { market: true, lineValue: true, snapshotType: true, capturedAt: true } },
      gameFlags: { select: { teamId: true, flagType: true } },
      modelPredictions: { orderBy: { generatedAt: "desc" }, take: 1 },
    },
  });

  const rows: Prisma.ModelGradeCreateManyInput[] = [];
  const outcome = (side: number, cover: number): "win" | "loss" | "push" =>
    Math.abs(cover) < 1e-9 ? "push" : Math.sign(side) === Math.sign(cover) ? "win" : "loss";

  for (const g of games) {
    const closeMargin = closingConsensus(g.lines, g.kickoffTime, "spread");
    if (closeMargin == null) continue;
    const actualMargin = g.homeScore! - g.awayScore!;
    const cover = actualMargin - closeMargin; // + = home covered

    // --- spread models ---
    const p = g.modelPredictions[0];
    const models: [string, number | null][] = [
      ["sp_plus", p?.predictedSpreadSpPlus ?? null],
      ["srs", p?.predictedSpreadSrs ?? null],
      ["yahn", p?.predictedSpreadYahn ?? null],
    ];
    for (const [key, m] of models) {
      if (m == null) continue;
      const side = Math.sign(m - closeMargin);
      if (side === 0) continue;
      rows.push({
        gameId: g.id, season, week, key,
        predMargin: r1(m), closeMargin: r1(closeMargin), actualMargin,
        side, edge: r1(Math.abs(m - closeMargin)),
        result: outcome(side, cover), absError: r1(Math.abs(m - actualMargin)),
      });
    }

    // --- flags (skip a type that fired on both teams — ambiguous) ---
    const byType = new Map<string, string[]>();
    for (const f of g.gameFlags) (byType.get(f.flagType) ?? byType.set(f.flagType, []).get(f.flagType)!).push(f.teamId);
    for (const [flagType, teamIds] of byType) {
      if (teamIds.length !== 1) continue;
      const dir = FLAG_FADE.has(flagType) ? -1 : FLAG_BACK.has(flagType) ? 1 : 0;
      if (dir === 0) continue;
      const onHome = teamIds[0] === g.homeTeamId;
      const side = onHome ? dir : -dir; // fade home = bet away = -1
      rows.push({
        gameId: g.id, season, week, key: `flag:${flagType}`,
        predMargin: null, closeMargin: r1(closeMargin), actualMargin,
        side, edge: null, result: outcome(side, cover), absError: null,
      });
    }
  }

  for (const row of rows) {
    await prisma.modelGrade.upsert({
      where: { gameId_key: { gameId: row.gameId, key: row.key } },
      update: { ...row, gradedAt: new Date() },
      create: row,
    });
  }
  console.log(`\nModelGrade rows written this run: ${rows.length}  (${games.length} final games)`);

  // --- season-to-date scoreboard ---
  const all = await prisma.modelGrade.findMany({
    where: { season },
    select: { key: true, result: true, edge: true, absError: true },
  });
  if (all.length === 0) return;

  const agg = (pred: (r: (typeof all)[number]) => boolean) => {
    const s = all.filter(pred);
    const w = s.filter((x) => x.result === "win").length;
    const l = s.filter((x) => x.result === "loss").length;
    const pu = s.filter((x) => x.result === "push").length;
    const n = w + l;
    const errs = s.map((x) => x.absError).filter((x): x is number => x != null);
    return { w, l, pu, n, rate: n ? w / n : 0, mae: errs.length ? mean(errs) : null };
  };
  const line = (label: string, a: ReturnType<typeof agg>) =>
    `  ${label.padEnd(20)} ${`${a.w}-${a.l}${a.pu ? `-${a.pu}` : ""}`.padEnd(11)} ` +
    `${a.n ? (100 * a.rate).toFixed(1) + "%" : "  –  "}   ` +
    `${a.mae != null ? `MAE ${a.mae.toFixed(2)}` : ""}`;

  console.log("\n============================================================");
  console.log(`SEASON ${season} — models vs the closing line (break-even 52.4%)`);
  console.log("------------------------------------------------------------");
  for (const k of ["sp_plus", "srs", "yahn"]) {
    console.log(line(k, agg((r) => r.key === k)));
    console.log(line(`  ${k} · edge≥2`, agg((r) => r.key === k && (r.edge ?? 0) >= 2)));
  }
  console.log("------------------------------------------------------------");
  console.log(`SEASON ${season} — flags (bet the implied side vs the close)`);
  console.log("------------------------------------------------------------");
  const flagKeys = [...new Set(all.map((r) => r.key).filter((k) => k.startsWith("flag:")))].sort();
  for (const k of flagKeys) console.log(line(k.replace("flag:", ""), agg((r) => r.key === k)));
  console.log("============================================================");
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
  console.log(`Logged picks this run:  ${w}-${l}-${pu} ATS`);
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
    console.log(`Logged picks, season ${season} to date:  ${g.win}-${g.loss}-${g.push} ATS`);
    if (sclv.length > 0) {
      const beat = sclv.filter((x) => x > 0).length;
      console.log(`CLV: ${beat}/${sclv.length} beat close, avg ${signed(mean(sclv))} pts`);
    }
  }

  // ---- grade every model + every flag vs the closing line ----
  await gradeModelsAndFlags(season, week);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
