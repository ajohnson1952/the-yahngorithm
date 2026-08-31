// ============================================================
// Poll rankings pull  (AP Top 25 + Coaches Poll)
// ============================================================
// Pulls CFBD /rankings into the Ranking table, one snapshot per
// (season, week, poll). AP releases Sunday, Coaches Poll too — a
// slightly earlier cadence than the Tuesday SP+ refresh, so this is
// its own script / its own admin button.
//
// Wipe + rewrite per (season, week, poll) so a re-run is idempotent.
//
// Run:  npm run pull-rankings                         (auto season/week)
//       npm run pull-rankings -- --season 2026 --week 3
//       npm run pull-rankings -- --all                (whole season, backfill)
// ============================================================

import { PrismaClient } from "@prisma/client";
import { cfbdGet, getCurrentSeasonWeek } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface CfbdRankWeek {
  season: number;
  week: number;
  seasonType: string;
  polls: {
    poll: string;
    ranks: {
      rank: number;
      school: string;
      firstPlaceVotes: number | null;
      points: number | null;
    }[];
  }[];
}

// which CFBD poll names we keep, and the short key we store them under
const POLLS: Record<string, string> = {
  "AP Top 25": "ap",
  "Coaches Poll": "coaches",
};

function parseArgs(): { season?: number; week?: number; all: boolean } {
  const args = process.argv.slice(2);
  const val = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const all = args.includes("--all");
  const season = val("--season");
  const week = val("--week");
  if (!all && ((season && !week) || (!season && week))) {
    console.error("Pass --season AND --week together, --all, or neither. Stopping.");
    process.exit(1);
  }
  return {
    season: season ? Number(season) : undefined,
    week: week ? Number(week) : undefined,
    all,
  };
}

async function main() {
  const { season: sArg, week: wArg, all } = parseArgs();
  const auto = await getCurrentSeasonWeek();
  const season = sArg ?? auto.season;

  const teams = await buildTeamResolver(prisma, "cfbd");

  // one CFBD call per week; --all sweeps the weeks we have games for
  let weeks: number[];
  if (all) {
    const wk = await prisma.game.findMany({
      where: { season },
      distinct: ["week"],
      select: { week: true },
      orderBy: { week: "asc" },
    });
    weeks = wk.map((w) => w.week);
  } else {
    weeks = [wArg ?? auto.week];
  }

  console.log(
    `Rankings pull — season ${season}, week${weeks.length > 1 ? "s" : ""} ${weeks.join(", ")}\n`
  );

  const unresolved = new Set<string>();
  let wrote = 0;

  for (const week of weeks) {
    const data = await cfbdGet<CfbdRankWeek[]>(
      `/rankings?year=${season}&week=${week}&seasonType=regular`
    ).catch(() => [] as CfbdRankWeek[]);
    const wkRow = data[0];
    if (!wkRow) {
      console.log(`  week ${week}: no rankings published`);
      continue;
    }

    for (const p of wkRow.polls) {
      const key = POLLS[p.poll];
      if (!key) continue;

      const rows = p.ranks
        .map((r) => {
          const teamId = teams.resolve(r.school);
          if (!teamId) {
            unresolved.add(r.school);
            return null;
          }
          return {
            season,
            week,
            poll: key,
            teamId,
            rank: r.rank,
            points: r.points ?? null,
            firstPlaceVotes: r.firstPlaceVotes ?? null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      await prisma.$transaction([
        prisma.ranking.deleteMany({ where: { season, week, poll: key } }),
        prisma.ranking.createMany({ data: rows }),
      ]);
      wrote += rows.length;
      console.log(`  week ${week} · ${key.toUpperCase()}: ${rows.length} teams`);
    }
  }

  console.log("\n============================================================");
  console.log(`Ranking rows written: ${wrote}`);
  if (unresolved.size > 0) {
    console.log(
      `Unresolved poll teams (${unresolved.size}): ${[...unresolved].join(", ")}`
    );
  }
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
