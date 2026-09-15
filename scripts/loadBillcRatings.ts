// ============================================================
// Load Bill Connelly's full-universe SP+ sheet
// ============================================================
// Bill C's sheet is the SOURCE OF RECORD for SP+ (overall/offense/defense),
// FBS included, not just a bridge for the teams CFBD doesn't rate. Why: CFBD's
// /ratings/sp is a live, unversioned endpoint (no working `week` param) — two
// pulls of it in the same week can legitimately return different numbers,
// which is exactly what caused a bad pick on JMU @ SDSU wk3 (2026-09-14, see
// docs/STATUS.md). Bill C's sheet updates exactly once when you see his
// Google Sheet change and choose to export + upload it — a real, discrete,
// human-controlled snapshot. CFBD stays the pace/possessions + SRS source
// (his sheet doesn't have those) and the automatic fallback for any team not
// in a given week's sheet (unresolved name, or no upload yet that week) — see
// pullRatings.ts, which now never overwrites a row this script has claimed.
//
// This loader:
//   1. parses data/billc/latest.csv (Team, Conf, Record, SP+, Rk, Off, Rk, Def, Rk)
//   2. re-centers his numbers onto CFBD's scale (verified: a pure additive
//      shift, no scale change — see git history for the 32-team check),
//      anchored to the season's WEEK-1 CFBD baseline — not the current
//      week's live CFBD read, which is exactly the moving target this
//      whole design avoids depending on. Same CSV in -> same numbers out,
//      always, no matter when or how many times you run this.
//   3. writes the re-centered numbers as the PRIMARY spPlusOverall/Offense/
//      Defense (spPlusSource='billc') for every team the sheet resolves,
//      FBS and FCS alike.
//
// The offset report it prints each run is the canary: a tight cluster means
// the two lists still agree; a wide spread means they've diverged from the
// week-1 baseline and the numbers that week need a second look.
//
// Run:  npm run load-billc                       (auto season/week, data/billc/latest.csv)
//       npm run load-billc -- --week 1 --file data/billc/2026-wk1.csv
// ============================================================

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

// Bill C sheet name -> our canonicalName, only where they differ
const NAME_OVERRIDES: Record<string, string> = {
  "Miami-FL": "Miami",
  "Miami-OH": "Miami (OH)",
  "UL-Lafayette": "Louisiana",
  "UL-Monroe": "UL Monroe",
  Hawaii: "Hawai'i",
  "San Jose State": "San José State",
  Connecticut: "UConn",
  "Appalachian State": "App State",
  "Albany-NY": "UAlbany",
  "SC State": "South Carolina State",
  "NC Central": "North Carolina Central",
  "NC A&T": "North Carolina A&T",
  UTRGV: "UT Rio Grande Valley",
  "McNeese State": "McNeese",
  "Nicholls State": "Nicholls",
  "Southeastern Louisiana": "SE Louisiana",
  "SE Missouri State": "Southeast Missouri State",
  ETSU: "East Tennessee State",
  UAPB: "Arkansas-Pine Bluff",
  MVSU: "Mississippi Valley State",
  "Saint Francis-PA": "Saint Francis",
  "Southern U.": "Southern",
  "Long Island": "Long Island University",
  USF: "South Florida",
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    week: val("--week") ? Number(val("--week")) : undefined,
    file: val("--file") ?? "data/billc/latest.csv",
  };
}

interface Row {
  team: string;
  overall: number;
  off: number;
  def: number;
}

function parseCsv(path: string): Row[] {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    // columns: Team,Conf,Record,SP+,Rk,Off,Rk,Def,Rk — team names here have no commas
    const c = line.split(",");
    if (c.length < 9) continue;
    const overall = Number(c[3]);
    const off = Number(c[5]);
    const def = Number(c[7]);
    if (!Number.isFinite(overall) || !Number.isFinite(off) || !Number.isFinite(def))
      continue;
    out.push({ team: c[0].trim(), overall, off, def });
  }
  return out;
}

async function main() {
  const { week: weekArg, file } = parseArgs();
  const auto = await getCurrentSeasonWeek();
  const season = auto.season;
  const week = weekArg ?? auto.week;

  const rows = parseCsv(file);
  console.log(`Parsed ${rows.length} rows from ${file}\n`);

  const teams = await buildTeamResolver(prisma, "cfbd");

  // resolve -> keep FIRST occurrence per teamId (sheet is SP+-sorted desc,
  // so the first "Monmouth"/"Cornell" is the D1 team, not the D3 dupe)
  const billcByTeamId = new Map<string, Row>();
  const unresolved: string[] = [];
  for (const r of rows) {
    const canonical = NAME_OVERRIDES[r.team] ?? r.team;
    const id = teams.resolve(canonical);
    if (!id) {
      unresolved.push(r.team);
      continue;
    }
    if (!billcByTeamId.has(id)) billcByTeamId.set(id, r);
  }

  // Scale anchor = the season's WEEK-1 CFBD preseason rows — fixed, immutable
  // once week 1 ends (pull-ratings never touches an old week's row again), so
  // the offset is a pure function of (this CSV, week-1 CFBD data) and never
  // drifts between runs the way anchoring to "whatever CFBD currently says"
  // would. Week 1 itself anchors to its own (necessarily preseason) rows.
  const week1Cfbd = await prisma.teamRatingWeekly.findMany({
    where: { season, week: 1, spPlusSource: null, spPlusOverall: { not: null } },
    select: { teamId: true, spPlusOverall: true, spPlusOffense: true, spPlusDefense: true },
  });
  const cfbdByTeam = new Map(week1Cfbd.map((r) => [r.teamId, r]));

  // --- offsets: billc − cfbd, over every FBS team in both, at week 1 ---
  const dOverall: number[] = [];
  const dOff: number[] = [];
  const dDef: number[] = [];
  for (const [teamId, c] of cfbdByTeam) {
    if (!teams.fbsTeamIds.has(teamId)) continue;
    const b = billcByTeamId.get(teamId);
    if (!b) continue;
    if (c.spPlusOverall != null) dOverall.push(b.overall - c.spPlusOverall);
    if (c.spPlusOffense != null) dOff.push(b.off - c.spPlusOffense);
    if (c.spPlusDefense != null) dDef.push(b.def - c.spPlusDefense);
  }
  if (dOverall.length < 20) {
    console.error(
      `Only ${dOverall.length} FBS teams overlap week-1 CFBD ratings for ${season}.\n` +
        `Run \`npm run pull-ratings -- --season ${season} --week 1\` first so there's a scale ` +
        `to anchor to. Stopping.`
    );
    process.exit(1);
  }
  const offOverall = median(dOverall);
  const offOff = median(dOff);
  const offDef = median(dDef);
  // robust spread: how far the middle 90% of teams sit from the median.
  const band = (xs: number[], med: number) => {
    const s = [...xs].map((x) => x - med).sort((a, b) => a - b);
    const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    return { lo: p(0.05), hi: p(0.95) };
  };
  const b = band(dOverall, offOverall);

  console.log("── offsets this upload (billc − cfbd wk1, median) ──");
  console.log(`  anchor   ${dOverall.length} FBS teams, week 1`);
  console.log(
    `  overall  ${offOverall.toFixed(2)}   (n=${dOverall.length}, middle-90%: ${b.lo.toFixed(1)}…+${b.hi.toFixed(1)} around it)`
  );
  console.log(`  offense  ${offOff.toFixed(2)}`);
  console.log(`  defense  ${offDef.toFixed(2)}`);
  // The band naturally widens the further the season gets from week 1 (both
  // lists have now watched different amounts of football independently) —
  // only shout if it's extreme.
  const bandLimit = 4 + week; // slack grows ~1pt/week off the week-1 anchor
  const wide = b.hi - b.lo > bandLimit;
  console.log(
    wide
      ? "  ⚠ middle-90% band unusually wide — sanity-check a few numbers.\n"
      : "  ✓ still tracking the week-1 anchor closely.\n"
  );

  // --- write: billc is the PRIMARY source for every team it resolves,
  // FBS included. pull-ratings (CFBD) never overwrites a spPlusSource='billc'
  // row's spPlus* fields once this has run for the week — it only refreshes
  // srs/avgPossessionsPerGame, and only fully owns a team's row when billc
  // doesn't cover it that week. ---
  let wrote = 0;
  for (const [teamId, r] of billcByTeamId) {
    await prisma.teamRatingWeekly.upsert({
      where: { teamId_season_week: { teamId, season, week } },
      update: {
        spPlusOverall: r.overall - offOverall,
        spPlusOffense: r.off - offOff,
        spPlusDefense: r.def - offDef,
        spPlusSource: "billc",
      },
      create: {
        teamId,
        season,
        week,
        spPlusOverall: r.overall - offOverall,
        spPlusOffense: r.off - offOff,
        spPlusDefense: r.def - offDef,
        spPlusSource: "billc",
      },
    });
    wrote++;
  }

  console.log("============================================================");
  console.log(`Season ${season}, week ${week}`);
  console.log(`Rows written (billc-sourced):  ${wrote}`);
  console.log(
    `\nRun \`npm run run-model && npm run generate-picks\` (or wait for the next tick) to pick up these numbers.`
  );
  const ourUnresolved = unresolved.filter(
    (n) => !/D3|NAIA|Ivy|NESCAC|MIAC|WIAC|CCIW|PAC$|OAC|NJAC|SCIAC/.test(n)
  );
  if (unresolved.length) {
    console.log(
      `\nUnresolved sheet names: ${unresolved.length} (most are D2/D3/NAIA we don't track).`
    );
    console.log(
      "  Likely-should-match:",
      ourUnresolved.slice(0, 30).join(", ") || "(none)"
    );
  }
  // any team in our table (FBS or FCS) with NO rating now, from EITHER source?
  const anyMissing = await prisma.team.count({
    where: {
      classification: { in: ["fbs", "fcs"] },
      ratingsWeekly: { none: { season, week } },
    },
  });
  console.log(
    anyMissing === 0
      ? "\nEvery FBS/FCS team in our table now has an SP+ rating for this week."
      : `\n>> ${anyMissing} team(s) still have no rating — check the unresolved list, or ` +
          `run pull-ratings if you haven't yet this week.`
  );
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
