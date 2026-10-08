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
//   weather    weather forecast + weather flags              ~8am / ~4pm CT
//   (polls)    pull-rankings, until the new AP poll lands    Sun 3/6/9pm, Mon 8/10am CT
// ============================================================

import { execFileSync } from "child_process";
import { PrismaClient, type Prisma } from "@prisma/client";
import { getCurrentSeasonWeek, cfbdAccount } from "../lib/cfbd";
import { spPlusFreshness } from "../lib/ratingsFreshness";
import { SITE_URL, revalidateToken } from "../lib/pipelineCache";

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

/** Wake Neon before anything else. A cold start is normally ~0.4 s, but 1 of
 *  ~1,700 in Sept took 27 s (Oct 1 00:00Z) — past Prisma's 5 s connect
 *  timeout, which crashed the tick before it ran a single step. Retry for up
 *  to ~a minute; the child scripts then find the DB already awake. */
async function wakeDb(tries = 6, waitMs = 5000) {
  for (let i = 1; ; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`  DB not reachable yet (try ${i}/${tries}) — retrying in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/** Tell the site its cached data is stale, then load the main pages once so
 *  their caches are rebuilt NOW, while Neon is already awake from this run —
 *  the next real visitor (or bot) then costs no DB wake-up at all. The site's
 *  caches have a long (12 h) backstop, so this call IS the freshness
 *  mechanism: a blip is retried once and then left to the next tick, but a
 *  401 (token mismatch — won't fix itself) fails the run so it gets noticed.
 *  See lib/pipelineCache.ts. */
async function refreshSite(): Promise<"ok" | "auth" | "error"> {
  const token = revalidateToken();
  if (!token) {
    console.log("site refresh skipped — no CFBD_API_KEY to derive the token from");
    return "auth";
  }
  try {
    const r = await fetch(`${SITE_URL}/api/revalidate`, {
      method: "POST",
      headers: { "x-yahn-token": token },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.error(
        `⚠ site revalidate failed: HTTP ${r.status}` +
          (r.status === 401 ? " — CFBD_API_KEY differs between GitHub and Vercel?" : "")
      );
      return r.status === 401 ? "auth" : "error";
    }
    // the nav pages, between them, fill every shared cache (board, current
    // week, weeks list, pick log, grade board)
    const codes: number[] = [];
    // …and the Cavepicks feed, so that app's requests never wake Neon either
    for (const path of ["/", "/watch", "/picks", "/grades", "/api/feed"]) {
      const warm = await fetch(`${SITE_URL}${path}`, { signal: AbortSignal.timeout(40_000) });
      await warm.text(); // drain the stream so the render (and its cache fill) completes
      codes.push(warm.status);
    }
    console.log(`site caches refreshed (revalidate ok, warm-up HTTP ${codes.join("/")})`);
    return "ok";
  } catch (e) {
    console.error(`⚠ site refresh failed: ${(e as Error).message}`);
    return "error";
  }
}

async function main() {
  const { dow, hour, minute } = centralNow();

  // Quiet hours: run 8am–10pm CT only. Every tick wakes Neon for its run plus
  // the 5-min autosuspend tail, and nothing overnight is worth that — no
  // lines to pull, nobody looking. The one exception is Saturday night until
  // 2am: late West-coast kicks (9:30–10:30pm CT) still need scores + grading.
  // Checked BEFORE any DB call so a skipped tick costs zero compute. Manual
  // --only runs always go through.
  const lateSaturday = (dow === 6 && hour >= 22) || (dow === 0 && hour < 2);
  if (!onlyArg && (hour < 8 || hour >= 22) && !lateSaturday) {
    console.log(
      `tick — ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} CT: ` +
        `quiet hours (runs 8am–10pm CT, Sat until 2am) — skipping, DB left asleep`
    );
    return;
  }

  await wakeDb();
  const activeHours = hour >= 8 || hour <= 1; // only the late-Saturday exception reaches the <=1 side now
  // No scores/lines pulls all day Tuesday (the weekly pull covers it) or before
  // ~5pm Wednesday — the only mid-week games are Tue/Wed-night MACtion in Nov.
  const midweekQuiet = dow === 2 || (dow === 3 && hour < 17);

  const [lastGames, lastLineRow, lastRatings, lastTrends, lastWeather, lastLinesAttempt] = await Promise.all([
    latestMs(prisma.game.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }), "updatedAt"),
    latestMs(prisma.line.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }), "capturedAt"),
    latestMs(prisma.teamRatingWeekly.findFirst({ orderBy: { pulledAt: "desc" }, select: { pulledAt: true } }), "pulledAt"),
    latestMs(prisma.teamTrend.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } }), "computedAt"),
    latestMs(prisma.weather.findFirst({ orderBy: { pulledAt: "desc" }, select: { pulledAt: true } }), "pulledAt"),
    latestMs(prisma.meta.findUnique({ where: { key: "lastLinesAttempt" }, select: { updatedAt: true } }), "updatedAt"),
  ]);
  // Pace line pulls off the last ATTEMPT, not the last saved row: once a
  // week's games have all kicked off a pull saves nothing, so the newest Line
  // row stops moving and the gate below would fire on every tick (it did -
  // all day Sunday, 2 Odds credits each). pull-lines stamps the Meta row on
  // every run, including the ones it skips.
  const lastLines = Math.max(lastLineRow, lastLinesAttempt);

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

    // lines: game windows. 30 min in the Saturday core, ~4 h elsewhere (was
    // ~2.75 h until Oct 8 2026: a five-Saturday month landed dead on the 500
    // credit cap with no margin). pull-lines also self-limits when the
    // monthly Odds credits run low, and skips for free when no game in the
    // week is still to kick off.
    lines:
      activeHours && !midweekQuiet &&
      minsAgo(lastLines) >= (satCore ? 25 : 225),

    // weekly heavy pull: Tuesday morning, once (last ratings pull > 20 h ago).
    weekly: dow === 2 && hour >= 8 && hour <= 11 && minsAgo(lastRatings) > 20 * 60,

    // trends: Sunday late morning, once.
    sunday: dow === 0 && hour >= 9 && hour <= 12 && minsAgo(lastTrends) > 20 * 60,

    // weather: ~8am (first tick of the day) and ~4pm CT, once each.
    weather: (hour === 8 || hour === 16) && minsAgo(lastWeather) > 5 * 60,
  };

  // --only <groups>: run exactly those, ignore the gates entirely.
  if (onlyArg) for (const g of Object.keys(run) as Group[]) run[g] = forced(g);

  // Early-season SP+ catch-up: only matters for a team still on CFBD's
  // fallback (Bill C's sheet — the source of record, loaded via load-billc —
  // hasn't covered it yet this week). CFBD's own number sits at the
  // preseason projection until Bill Connelly's first in-season revision
  // (~wk 2-3), and we only pull it on Tuesdays otherwise, so a mid-week
  // fallback update would be missed. Until the week is broadly fresh, pull
  // ratings ~daily; once it is, this goes quiet again. Cannot substitute for
  // actually uploading his sheet — see loadBillcRatings.ts.
  let ratingsCatchup = false;
  if (!run.weekly && !onlyArg && minsAgo(lastRatings) >= 12 * 60) {
    try {
      const { season, week } = await getCurrentSeasonWeek();
      if (week >= 2 && !(await spPlusFreshness(prisma, season, week)).fresh) {
        ratingsCatchup = true;
      }
    } catch {
      /* calendar/DB hiccup — skip the catch-up this tick */
    }
  }

  // Polls: AP + Coaches release Sunday ~1pm CT, but the weekly pull that used
  // to be their only pickup is Tuesday — a day and a half with last week's
  // ranks on the board. Try a few fixed slots Sun afternoon → Mon morning
  // (≤ 5 CFBD calls in a week the poll is late, usually 1) and stop once this
  // week's AP poll is stored. CFBD's calendar rolls to the new week Monday
  // ~2am CT, and the Sunday poll is labeled with that NEW week — so on Sunday
  // the target is current week + 1. An empty response (not out yet) writes
  // nothing, so a too-early try is harmless.
  let rankingsArgs: string[] | null = null;
  const pollSlot =
    ((dow === 0 && [15, 18, 21].includes(hour)) || (dow === 1 && [8, 10].includes(hour))) &&
    minute < 30;
  if (!run.weekly && !onlyArg && pollSlot) {
    try {
      const { season, week } = await getCurrentSeasonWeek();
      const target = dow === 0 ? week + 1 : week;
      const have = await prisma.ranking.findFirst({
        where: { season, poll: "ap", week: target },
        select: { week: true },
      });
      if (!have) rankingsArgs = ["--season", String(season), "--week", String(target)];
    } catch {
      /* calendar/DB hiccup — the Tuesday weekly pull still covers it */
    }
  }

  const w = run.weekly;
  const steps: { name: string; args: string[]; on: boolean }[] = [
    { name: "pull-ratings", args: [], on: w || ratingsCatchup },
    { name: "pull-rankings", args: w ? [] : rankingsArgs ?? [], on: w || rankingsArgs != null },
    { name: "pull-advanced", args: [], on: w || run.sunday },
    { name: "pull-games", args: [], on: run.scores || w },
    { name: "pull-lines", args: ["--type", run.lines ? "daily" : "open"], on: run.lines || w },
    { name: "pull-kalshi", args: [], on: run.heartbeat || w },
    { name: "pull-weather", args: [], on: run.weather },
    { name: "compute-weather-flags", args: [], on: run.weather || w },
    { name: "compute-flags", args: [], on: w },
    // steam/RLM only change when new lines land (or, slowly, as Kalshi drifts) —
    // and this step re-reads ~40 h of line history, so run it when lines were
    // just pulled and on the top-of-the-hour tick, not every 30 min
    { name: "compute-market-flags", args: [], on: run.lines || w || (run.heartbeat && minute < 30) },
    { name: "run-model", args: [], on: run.heartbeat || w },
    { name: "generate-picks", args: [], on: run.heartbeat || w },
    { name: "grade-picks", args: [], on: run.scores || w || run.sunday },
    { name: "compute-trends", args: [], on: run.sunday },
  ];
  const plan = steps.filter((s) => s.on);
  const activeGroups = (Object.keys(run) as Group[]).filter((g) => run[g]);

  const stamp = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} CT`;
  console.log(`tick — ${stamp}`);
  console.log(
    `  groups: ${activeGroups.join(", ") || "(none)"}` +
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

  // CFBD meter before/after the steps (free to read). Our own call counter
  // was a third low in both Sept and Oct 2026 - this log shows whether the
  // missing calls happen inside a tick (and next to which steps) or between
  // ticks (something else using the key). Read it with `npm run cfbd-usage`.
  const countedCfbd = async () =>
    (
      await prisma.apiUsage
        .findUnique({ where: { api_yearMonth: { api: "cfbd", yearMonth: new Date().toISOString().slice(0, 7) } } })
        .catch(() => null)
    )?.calls ?? 0;
  const [cfbdBefore, countedBefore] = await Promise.all([cfbdAccount(), countedCfbd()]);

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

  try {
    const [cfbdAfter, countedAfter] = await Promise.all([cfbdAccount(), countedCfbd()]);
    if (cfbdBefore && cfbdAfter) {
      const row = await prisma.meta.findUnique({ where: { key: "cfbdUsageLog" } });
      const log = Array.isArray(row?.value) ? (row!.value as unknown[]) : [];
      log.push({
        t: new Date().toISOString(),
        before: cfbdBefore.used,
        after: cfbdAfter.used,
        counted: countedAfter - countedBefore,
        steps: plan.map((s) => s.name).filter((n) => n.startsWith("pull-")),
      });
      const value = log.slice(-400) as Prisma.InputJsonValue;
      await prisma.meta.upsert({
        where: { key: "cfbdUsageLog" },
        update: { value },
        create: { key: "cfbdUsageLog", value },
      });
      console.log(
        `\nCFBD: ${cfbdAfter.used - cfbdBefore.used} calls this tick (we counted ${countedAfter - countedBefore}) - ` +
          `${cfbdAfter.remaining} of ${cfbdAfter.limit} left this month`
      );
    }
  } catch {
    /* bookkeeping only - never fail a tick over it */
  }

  // heartbeat marker for the /admin freshness panel — "the scheduler fired"
  await prisma.meta
    .upsert({
      where: { key: "lastTick" },
      update: { value: { groups: activeGroups, failed } },
      create: { key: "lastTick", value: { groups: activeGroups, failed } },
    })
    .catch(() => {});

  let site = await refreshSite();
  if (site === "error") site = await refreshSite(); // one retry for a blip
  if (site !== "ok") failed.push("site-refresh");

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
    "compute-flags", "compute-market-flags", "compute-weather-flags", "run-model",
    "generate-picks", "grade-picks", "compute-trends",
  ]);
  const hardFail =
    site === "auth" ||
    failed.some((f) => onlyArg != null || run.weekly || COMPUTE.has(f.split(" ")[0]));
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
