// ============================================================
// The scheduler tick  (PROJECT_BRIEF: replaces GitHub's flaky cron)
// ============================================================
// ONE entrypoint, hit every ~30 min by cron-job.org (which fires the
// tick.yml workflow via GitHub's workflow_dispatch API). This script
// looks at the wall clock (America/Chicago) and how stale each data
// source is, then runs exactly the npm scripts that are due — in
// dependency order. All schedule logic lives HERE, versioned, testable.
//
//   npx tsx --env-file=.env scripts/tick.ts
//   npx tsx --env-file=.env scripts/tick.ts --dry           print the plan, run nothing
//   npx tsx --env-file=.env scripts/tick.ts --only weekly   force one group, skip the gates
//   npx tsx --env-file=.env scripts/tick.ts --only scores,lines
//
// Groups:
//   heartbeat  kalshi + market flags + model + picks        every tick
//   scores     pull-games + grade-picks                     game windows
//   lines      pull-lines --daily                           game windows, rate-limited
//   weekly     the full Tuesday heavy pull                   Tue ~9am CT, once
//   sunday     pull-advanced + compute-trends                Sun ~10am CT, once
//   weather    weather + injuries                            ~6am / ~4pm CT
// ============================================================

import { execFileSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Group = "heartbeat" | "scores" | "lines" | "weekly" | "sunday" | "weather";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const onlyArg = (() => {
  const i = argv.indexOf("--only");
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(",").map((s) => s.trim()) : null;
})();
const forced = (g: Group) => onlyArg?.includes(g) ?? false;

/** {dow 0=Sun..6=Sat, hour 0..23, minute} in America/Chicago */
function centralNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[get("weekday")] ?? 0, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

async function latestMs(
  q: Promise<Record<string, Date | null> | null>,
  key: string
): Promise<number> {
  const row = await q;
  const v = row?.[key];
  return v ? v.getTime() : 0;
}
const minsAgo = (ms: number) => (ms === 0 ? Infinity : (Date.now() - ms) / 60000);

async function main() {
  const { dow, hour, minute } = centralNow();
  const activeHours = hour >= 8 || hour <= 1; // 8am–1am CT covers late West-coast kicks
  // No scores/lines pulls all day Tuesday (the weekly pull covers it) or before
  // ~5pm Wednesday — the only mid-week games are Tue/Wed-night MACtion in Nov.
  const midweekQuiet = dow === 2 || (dow === 3 && hour < 17);

  const [lastGames, lastLines, lastRatings, lastTrends, lastWeather] = await Promise.all([
    latestMs(prisma.game.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }), "updatedAt"),
    latestMs(prisma.line.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }), "capturedAt"),
    latestMs(prisma.teamRatingWeekly.findFirst({ orderBy: { pulledAt: "desc" }, select: { pulledAt: true } }), "pulledAt"),
    latestMs(prisma.teamTrend.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } }), "computedAt"),
    latestMs(prisma.weather.findFirst({ orderBy: { pulledAt: "desc" }, select: { pulledAt: true } }), "pulledAt"),
  ]);

  // ---- decide which groups are due ----
  const satCore = dow === 6 && hour >= 9 && hour <= 20;

  const run: Record<Group, boolean> = {
    // cheap, DB-only + free Kalshi reads — every tick
    heartbeat: true,

    // scores: game windows, skip the mid-week daytime dead zone. Rate-limit so
    // it's ~30 min on Saturday, ~hourly otherwise.
    scores:
      activeHours && !midweekQuiet &&
      minsAgo(lastGames) >= (satCore ? 25 : 55),

    // lines: game windows. 30 min in the Saturday core, ~2.75 h elsewhere.
    // pull-lines also self-limits when the monthly Odds credits run low.
    lines:
      activeHours && !midweekQuiet &&
      minsAgo(lastLines) >= (satCore ? 25 : 165),

    // weekly heavy pull: Tuesday morning, once (last ratings pull > 20 h ago).
    weekly: dow === 2 && hour >= 8 && hour <= 11 && minsAgo(lastRatings) > 20 * 60,

    // trends: Sunday late morning, once.
    sunday: dow === 0 && hour >= 9 && hour <= 12 && minsAgo(lastTrends) > 20 * 60,

    // weather + injuries: ~6am and ~4pm CT, once each.
    weather: (hour === 6 || hour === 16) && minsAgo(lastWeather) > 5 * 60,
  };

  // --only <groups>: run exactly those, ignore the gates entirely.
  if (onlyArg) for (const g of Object.keys(run) as Group[]) run[g] = forced(g);

  const w = run.weekly;
  const steps: { name: string; args: string[]; on: boolean }[] = [
    { name: "pull-ratings", args: [], on: w },
    { name: "pull-rankings", args: [], on: w },
    { name: "pull-advanced", args: [], on: w || run.sunday },
    { name: "pull-games", args: [], on: run.scores || w },
    { name: "pull-lines", args: ["--type", run.lines ? "daily" : "open"], on: run.lines || w },
    { name: "pull-kalshi", args: [], on: run.heartbeat || w },
    { name: "pull-weather", args: [], on: run.weather },
    { name: "pull-injuries", args: [], on: run.weather },
    { name: "compute-flags", args: [], on: w },
    { name: "compute-market-flags", args: [], on: run.heartbeat || w },
    { name: "run-model", args: [], on: run.heartbeat || w },
    { name: "generate-picks", args: [], on: run.heartbeat || w },
    { name: "grade-picks", args: [], on: run.scores || w || run.sunday },
    { name: "compute-trends", args: [], on: run.sunday },
  ];
  const plan = steps.filter((s) => s.on);

  const stamp = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} CT`;
  console.log(`tick — ${stamp}`);
  console.log(
    `  groups: ${(Object.keys(run) as Group[]).filter((g) => run[g]).join(", ") || "(none)"}` +
      (onlyArg ? `   [--only ${onlyArg.join(",")}]` : "")
  );
  console.log(
    `  staleness: games ${Math.round(minsAgo(lastGames))}m · lines ${Math.round(minsAgo(lastLines))}m`
  );
  console.log(`  plan: ${plan.map((s) => s.name + (s.args.length ? ` ${s.args.join(" ")}` : "")).join(" → ") || "(nothing due)"}`);

  if (DRY) {
    await prisma.$disconnect();
    return;
  }

  const failed: string[] = [];
  for (const s of plan) {
    const label = s.name + (s.args.length ? ` ${s.args.join(" ")}` : "");
    console.log(`\n──────── ${label} ────────`);
    try {
      execFileSync("npm", ["run", s.name, ...(s.args.length ? ["--", ...s.args] : [])], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
    } catch {
      console.error(`✗ ${label} failed`);
      failed.push(label);
    }
  }

  await prisma.$disconnect();
  console.log(
    `\ntick done — ${plan.length - failed.length}/${plan.length} ok` +
      (failed.length ? `, failed: ${failed.join(", ")}` : "")
  );

  // A failed data pull (CFBD / Odds / Kalshi 5xx/timeout) is almost always an
  // upstream outage — the next tick retries. Only hard-fail the run (→ red on
  // cron-job.org, failure email) when a pure-compute step broke, or when this
  // was an explicit --only / weekly run the operator is watching.
  const COMPUTE = new Set([
    "compute-flags", "compute-market-flags", "run-model", "generate-picks",
    "grade-picks", "compute-trends",
  ]);
  const hardFail = failed.some(
    (f) => onlyArg != null || run.weekly || COMPUTE.has(f.split(" ")[0])
  );
  if (failed.length && !hardFail) {
    console.log("  (data-pull failures only — treating as a transient upstream outage, not failing the tick)");
  }
  if (hardFail) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
