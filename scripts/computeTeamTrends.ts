// ============================================================
// Team trends — ATS / straight-up / over-under splits
// ============================================================
// Per team, current season (or --season X): walk the completed games
// that have a closing line and tally:
//   - ATS overall, ATS home, ATS away
//   - straight-up W-L home, straight-up W-L away
//   - ATS as favorite, ATS as underdog
//   - over / under lean
//   - ATS in the game AFTER a win, ATS after a loss
//
// An "outlier" split = >=65% or <=35% cover rate with n>=8. Those are
// surfaced as chips on the game page (not pipeline flags yet — calibrate
// first, same as we did with the situational flags).
//
// Wipe + rewrite per season. Run Sundays after grade-picks.
//
// Run:  npm run compute-trends                (current season)
//       npm run compute-trends -- --season 2025
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { median } from "../lib/consensus";

const prisma = new PrismaClient();

const OUTLIER_MIN_N = 8;
const OUTLIER_HI = 0.65;
const OUTLIER_LO = 0.35;

type WLP = { w: number; l: number; p: number };
const wlp = (): WLP => ({ w: 0, l: 0, p: 0 });
const add = (r: WLP, o: "w" | "l" | "p") => {
  r[o]++;
};

function coverRate(r: WLP): number | null {
  const n = r.w + r.l;
  return n === 0 ? null : r.w / n;
}
function isOutlier(r: WLP): boolean {
  const n = r.w + r.l;
  if (n < OUTLIER_MIN_N) return false;
  const rate = r.w / n;
  return rate >= OUTLIER_HI || rate <= OUTLIER_LO;
}

async function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf("--season");
  const season =
    si >= 0 && args[si + 1]
      ? Number(args[si + 1])
      : (await getCurrentSeasonWeek()).season;

  console.log(`Team trends — season ${season}\n`);

  const games = await prisma.game.findMany({
    where: { season, status: "final", homeScore: { not: null }, awayScore: { not: null } },
    select: {
      id: true,
      week: true,
      kickoffTime: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      lines: {
        where: { snapshotType: "close" },
        select: { market: true, lineValue: true },
      },
    },
    orderBy: [{ week: "asc" }, { kickoffTime: "asc" }],
  });

  // closing consensus per game
  const closeByGame = new Map<
    string,
    { spread: number | null; total: number | null }
  >();
  for (const g of games) {
    const spreads = g.lines.filter((l) => l.market === "spread").map((l) => l.lineValue);
    const totals = g.lines.filter((l) => l.market === "total").map((l) => l.lineValue);
    closeByGame.set(g.id, {
      spread: spreads.length ? median(spreads) : null,
      total: totals.length ? median(totals) : null,
    });
  }

  // per team, chronological list of their games
  const byTeam = new Map<
    string,
    {
      week: number;
      isHome: boolean;
      teamMargin: number;
      teamLine: number | null; // team's spread (neg = team favored)
      gameTotal: number;
      closeTotal: number | null;
    }[]
  >();

  for (const g of games) {
    const c = closeByGame.get(g.id)!;
    const push = (teamId: string, isHome: boolean) => {
      const teamMargin = isHome
        ? g.homeScore! - g.awayScore!
        : g.awayScore! - g.homeScore!;
      const teamLine =
        c.spread == null ? null : isHome ? c.spread : -c.spread;
      const arr = byTeam.get(teamId) ?? [];
      arr.push({
        week: g.week,
        isHome,
        teamMargin,
        teamLine,
        gameTotal: g.homeScore! + g.awayScore!,
        closeTotal: c.total,
      });
      byTeam.set(teamId, arr);
    };
    push(g.homeTeamId, true);
    push(g.awayTeamId, false);
  }

  const rows: Prisma.TeamTrendCreateManyInput[] = [];

  for (const [teamId, list] of byTeam) {
    list.sort((a, b) => a.week - b.week);

    const ats = wlp();
    const atsHome = wlp();
    const atsAway = wlp();
    const suHome = wlp();
    const suAway = wlp();
    const atsFav = wlp();
    const atsDog = wlp();
    const atsAfterWin = wlp();
    const atsAfterLoss = wlp();
    let over = 0;
    let under = 0;
    let ouPush = 0;
    let withLine = 0;

    list.forEach((g, i) => {
      // straight up
      add(g.isHome ? suHome : suAway, g.teamMargin > 0 ? "w" : g.teamMargin < 0 ? "l" : "p");

      // ATS
      if (g.teamLine != null) {
        withLine++;
        const diff = g.teamMargin + g.teamLine;
        const res: "w" | "l" | "p" =
          diff > 0.01 ? "w" : diff < -0.01 ? "l" : "p";
        add(ats, res);
        add(g.isHome ? atsHome : atsAway, res);
        if (g.teamLine < -0.01) add(atsFav, res);
        else if (g.teamLine > 0.01) add(atsDog, res);

        const prev = list[i - 1];
        if (prev) {
          if (prev.teamMargin > 0) add(atsAfterWin, res);
          else if (prev.teamMargin < 0) add(atsAfterLoss, res);
        }
      }

      // over / under
      if (g.closeTotal != null) {
        const d = g.gameTotal - g.closeTotal;
        if (d > 0.01) over++;
        else if (d < -0.01) under++;
        else ouPush++;
      }
    });

    const ou = { over, under, push: ouPush };
    const outliers: string[] = [];
    const check = (key: string, r: WLP) => {
      if (isOutlier(r)) outliers.push(key);
    };
    check("ats", ats);
    check("atsHome", atsHome);
    check("atsAway", atsAway);
    check("atsFav", atsFav);
    check("atsDog", atsDog);
    check("atsAfterWin", atsAfterWin);
    check("atsAfterLoss", atsAfterLoss);
    // O/U outlier: >=65%/<=35% one way with n>=8
    const ouN = over + under;
    if (ouN >= OUTLIER_MIN_N) {
      if (over / ouN >= OUTLIER_HI) outliers.push("over");
      else if (under / ouN >= OUTLIER_HI) outliers.push("under");
    }

    rows.push({
      teamId,
      season,
      splits: {
        games: list.length,
        gamesWithLine: withLine,
        ats,
        atsHome,
        atsAway,
        suHome,
        suAway,
        atsFav,
        atsDog,
        ou,
        atsAfterWin,
        atsAfterLoss,
        outliers,
      } as Prisma.InputJsonValue,
    });
  }

  await prisma.$transaction([
    prisma.teamTrend.deleteMany({ where: { season } }),
    prisma.teamTrend.createMany({ data: rows }),
  ]);

  const withOutliers = rows.filter(
    (r) => ((r.splits as Record<string, unknown>).outliers as string[]).length > 0
  ).length;

  console.log("============================================================");
  console.log(`Teams with completed games:  ${rows.length}`);
  console.log(`Teams with an outlier split: ${withOutliers}`);
  console.log("============================================================");

  // a peek
  const sample = rows
    .map((r) => ({
      id: r.teamId,
      s: r.splits as Record<string, { w: number; l: number } | unknown>,
    }))
    .filter((x) => ((x.s as any).outliers as string[]).length)
    .slice(0, 8);
  if (sample.length) {
    const names = new Map(
      (
        await prisma.team.findMany({
          where: { id: { in: sample.map((s) => s.id) } },
          select: { id: true, canonicalName: true },
        })
      ).map((t) => [t.id, t.canonicalName])
    );
    for (const s of sample) {
      const sp = s.s as any;
      console.log(
        `  ${names.get(s.id)}: ${sp.outliers.join(", ")} ` +
          `(ATS ${sp.ats.w}-${sp.ats.l}-${sp.ats.p})`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
