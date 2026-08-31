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
//   HFA(team) = BASE + max( altitude bump , hostile-venue bump )
//
// altitude bump  — from Team.elevationM, data-supported.
// hostile bump   — a small hand-set list of famous cauldrons
//                  (HOSTILE_BUMP below), user-curated. The two do NOT
//                  stack — a team gets whichever is larger.
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

// Manual "famous hostile venue" bump. Small, hand-set (see docs/guide §1).
// A team gets BASE + max(altitude, hostile) — the two do NOT stack.
const HOSTILE_BUMP: Record<string, number> = {
  // Tier 1 — the poll-toppers
  LSU: 0.4,
  "Texas A&M": 0.4,
  "Penn State": 0.4,
  Oregon: 0.4,
  // Tier 2 — always top ~10
  "Ohio State": 0.25,
  Georgia: 0.25,
  Alabama: 0.25,
  Tennessee: 0.25,
  Clemson: 0.25,
  Florida: 0.25,
  Auburn: 0.25,
  Wisconsin: 0.25,
  Oklahoma: 0.25,
  // Tier 3 — loud, real edge, a notch below
  "Virginia Tech": 0.15,
  Texas: 0.15,
  "South Carolina": 0.15,
  "West Virginia": 0.15,
  Iowa: 0.15,
  Washington: 0.15,
  "Notre Dame": 0.15,
  "Mississippi State": 0.15,
  "Ole Miss": 0.15,
  Michigan: 0.15,
};

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
  console.log(`Per-team HFA — rules-based (base ${BASE_HFA} + max(altitude, hostile))\n`);

  const teams = await prisma.team.findMany({
    where: { classification: "fbs" },
    select: { id: true, canonicalName: true, elevationM: true },
  });

  // typo guard: every HOSTILE_BUMP key must match a real team
  const knownNames = new Set(teams.map((t) => t.canonicalName));
  const badKeys = Object.keys(HOSTILE_BUMP).filter((k) => !knownNames.has(k));
  if (badKeys.length) {
    console.error(`HOSTILE_BUMP keys with no matching team: ${badKeys.join(", ")}`);
    process.exit(1);
  }

  const bumpOf = (t: { canonicalName: string; elevationM: number | null }) => {
    const alt = altitudeBump(t.elevationM);
    const hostile = HOSTILE_BUMP[t.canonicalName] ?? 0;
    return { alt, hostile, applied: Math.max(alt, hostile) };
  };

  const rows: Prisma.TeamHfaCreateManyInput[] = teams.map((t) => ({
    teamId: t.id,
    hfa: Math.round((BASE_HFA + bumpOf(t).applied) * 100) / 100,
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

  const byId = new Map(teams.map((t) => [t.id, t]));
  const adjusted = rows
    .filter((r) => r.hfa > BASE_HFA)
    .sort((a, b) => b.hfa - a.hfa);

  console.log("============================================================");
  console.log(
    `TeamHfa rows written: ${rows.length}  (base ${BASE_HFA}, ${adjusted.length} adjusted)\n`
  );
  console.log(
    `  ${"venue".padEnd(22)} ${"HFA".padStart(5)}  reason${" ".repeat(14)}SP+-residual diag`
  );
  for (const r of adjusted) {
    const t = byId.get(r.teamId)!;
    const b = bumpOf(t);
    const reason =
      b.alt >= b.hostile
        ? `altitude +${b.alt.toFixed(2)}`
        : `hostile +${b.hostile.toFixed(2)}`;
    const d = resid.get(r.teamId);
    console.log(
      `  ${t.canonicalName.padEnd(22)} ${r.hfa.toFixed(2).padStart(5)}  ` +
        `${reason.padEnd(20)}${d && d.length >= 10 ? mean(d).toFixed(1) : "n/a"}`
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
