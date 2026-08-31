// ============================================================
// Load Bill Connelly's full-universe SP+ sheet
// ============================================================
// CFBD's SP+ feed is FBS only. Bill C publishes the same model for
// ~772 teams (FBS + FCS + lower). Verified: his "SP+" is CFBD's number
// plus a constant (~+52.1 overall, +26.0 off, -26.1 def), a pure shift
// with no scale change (see git history for the 32-team check).
//
// This loader:
//   1. parses data/billc/latest.csv (Team, Conf, Record, SP+, Rk, Off, Rk, Def, Rk)
//   2. re-derives the three offsets FRESH from the FBS teams that appear
//      in both the sheet and our current CFBD ratings (median, so a team
//      Bill C has updated a game ahead of us doesn't skew it)
//   3. writes re-centered SP+ into TeamRatingWeekly for teams CFBD does
//      NOT rate (FCS and below), spPlusSource='billc'
//
// The offset report it prints each run is the canary: a tight cluster
// means the two lists still agree; a wide spread means they've diverged
// and the FCS numbers that week need a second look.
//
// Run:  npm run load-billc                       (auto season/week, data/billc/latest.csv)
//       npm run load-billc -- --week 1 --file data/billc/2026-wk1.csv
//       npm run load-billc -- --overwrite-fbs    (also rewrite FBS from the sheet — not default)
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
    overwriteFbs: args.includes("--overwrite-fbs"),
  };
}

interface Row {
  team: string;
  overall: number;
  off: number;
  def: number;
  played: boolean; // has this team played a game (record not 0-0)?
}

function parseCsv(path: string): Row[] {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    // columns: Team,Conf,Record,SP+,Rk,Off,Rk,Def,Rk  — team names here have no commas
    const c = line.split(",");
    if (c.length < 9) continue;
    const overall = Number(c[3]);
    const off = Number(c[5]);
    const def = Number(c[7]);
    if (!Number.isFinite(overall) || !Number.isFinite(off) || !Number.isFinite(def))
      continue;
    // Record col (c[2]): "0-0" or Excel-mangled "Jan-00" = unplayed;
    // "1-0" / "0-1" etc. = has played, so its number may be a game ahead of ours
    const rec = c[2].trim();
    const played = /^[1-9]\d*-\d+$|^\d+-[1-9]\d*$/.test(rec);
    out.push({ team: c[0].trim(), overall, off, def, played });
  }
  return out;
}

async function main() {
  const { week: weekArg, file, overwriteFbs } = parseArgs();
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

  // current SP+ rows for this week; the CFBD-sourced ones are our scale anchor
  const allRatings = await prisma.teamRatingWeekly.findMany({
    where: { season, week, spPlusOverall: { not: null } },
    select: {
      teamId: true,
      spPlusSource: true,
      spPlusOverall: true,
      spPlusOffense: true,
      spPlusDefense: true,
    },
  });
  const cfbd = allRatings.filter(
    (r) => r.spPlusSource !== "billc" && teams.fbsTeamIds.has(r.teamId)
  );

  // --- offsets, from teams in both ---
  const dOverall: number[] = [];
  const dOff: number[] = [];
  const dDef: number[] = [];
  for (const c of cfbd) {
    const b = billcByTeamId.get(c.teamId);
    if (!b || b.played) continue; // only unplayed teams — same reference point
    if (c.spPlusOverall != null) dOverall.push(b.overall - c.spPlusOverall);
    if (c.spPlusOffense != null) dOff.push(b.off - c.spPlusOffense);
    if (c.spPlusDefense != null) dDef.push(b.def - c.spPlusDefense);
  }
  if (dOverall.length < 20) {
    console.error(
      `Only ${dOverall.length} FBS teams overlap CFBD ratings for ${season} wk ${week}.\n` +
        `Run \`npm run pull-ratings\` first so there's a scale to anchor to. Stopping.`
    );
    process.exit(1);
  }
  const offOverall = median(dOverall);
  const offOff = median(dOff);
  const offDef = median(dDef);
  // robust spread: how far the middle 90% of teams sit from the median.
  // A few teams drift after week-0 games (Bill C updates them, our CFBD
  // snapshot hasn't) — that's expected. A big p5–p95 band is the real alarm.
  const band = (xs: number[], med: number) => {
    const s = [...xs].map((x) => x - med).sort((a, b) => a - b);
    const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    return { lo: p(0.05), hi: p(0.95) };
  };
  const b = band(dOverall, offOverall);

  console.log("── offsets this upload (billc − cfbd, median) ──");
  console.log(
    `  overall  ${offOverall.toFixed(2)}   (n=${dOverall.length}, middle-90%: ${b.lo.toFixed(1)}…+${b.hi.toFixed(1)} around it)`
  );
  console.log(`  offense  ${offOff.toFixed(2)}`);
  console.log(`  defense  ${offDef.toFixed(2)}`);
  const wide = b.hi - b.lo > 4;
  console.log(
    wide
      ? "  ⚠ middle-90% band > 4 pts — the two lists have genuinely drifted; sanity-check the FCS numbers.\n"
      : "  ✓ the lists still agree (a couple of week-0 teams aside).\n"
  );

  // --- write ---
  const cfbdTeamIds = new Set(cfbd.map((c) => c.teamId));
  let wrote = 0;
  let skippedFbs = 0;
  for (const [teamId, b] of billcByTeamId) {
    const isFbs = teams.fbsTeamIds.has(teamId);
    if (isFbs && cfbdTeamIds.has(teamId) && !overwriteFbs) {
      skippedFbs++;
      continue;
    }
    await prisma.teamRatingWeekly.upsert({
      where: { teamId_season_week: { teamId, season, week } },
      update: {
        spPlusOverall: b.overall - offOverall,
        spPlusOffense: b.off - offOff,
        spPlusDefense: b.def - offDef,
        spPlusSource: "billc",
      },
      create: {
        teamId,
        season,
        week,
        spPlusOverall: b.overall - offOverall,
        spPlusOffense: b.off - offOff,
        spPlusDefense: b.def - offDef,
        spPlusSource: "billc",
      },
    });
    wrote++;
  }

  console.log("============================================================");
  console.log(`Season ${season}, week ${week}`);
  console.log(`Rows written (billc-sourced):  ${wrote}`);
  console.log(`FBS rows left on CFBD:         ${skippedFbs}`);
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
  // any FCS team in our table with NO rating now?
  const fcsMissing = await prisma.team.count({
    where: {
      classification: "fcs",
      ratingsWeekly: { none: { season, week } },
    },
  });
  console.log(
    fcsMissing === 0
      ? "\nEvery FCS team in our table now has an SP+ rating for this week."
      : `\n>> ${fcsMissing} FCS team(s) still have no rating — check the unresolved list.`
  );
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
