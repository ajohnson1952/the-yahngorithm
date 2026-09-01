// ============================================================
// Weather snapshots  (PROJECT_BRIEF: Open-Meteo, free, no key)
// ============================================================
// For each upcoming outdoor game in the target week whose kickoff is
// within Open-Meteo's ~16-day forecast horizon, snapshot the forecast
// nearest to kickoff into the Weather table.
//
// INSERT-only, like lines — every run is a point-in-time snapshot, so
// running it Tuesday and again Saturday morning gives you the drift.
// The brief wants the Saturday-morning pull to be the one that counts.
//
// Indoor games are skipped. No API key needed.
//
// Run:  npm run pull-weather
//       npm run pull-weather -- --season 2026 --week 3
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import { forecastAt } from "../lib/openMeteo";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const o = parseArgs();
  const { season, week } =
    o.season != null && o.week != null
      ? { season: o.season, week: o.week }
      : await getCurrentSeasonWeek();

  console.log(`Weather snapshot — season ${season}, week ${week}\n`);

  const games = await prisma.game.findMany({
    where: { season, week },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoffTime: "asc" },
  });

  const now = new Date();
  const rows: Prisma.WeatherCreateManyInput[] = [];
  let indoor = 0;
  let played = 0;
  let noCoords = 0;
  let tooFarOut = 0;
  const captured: string[] = [];

  for (const g of games) {
    if (g.indoor) {
      indoor++;
      continue;
    }
    if (g.status === "final") {
      played++;
      continue;
    }
    if (g.venueLat == null || g.venueLng == null) {
      noCoords++;
      continue;
    }

    const wx = await forecastAt(g.venueLat, g.venueLng, g.kickoffTime, now);
    await sleep(120); // be polite to a free service
    if (!wx) {
      tooFarOut++;
      continue;
    }

    rows.push({
      gameId: g.id,
      tempF: wx.tempF,
      feelsF: wx.feelsF,
      humidityPct: wx.humidityPct,
      windMph: wx.windMph,
      windGustMph: wx.windGustMph,
      precipProbability: wx.precipProb,
      rainMmHr: wx.rainMmHr,
      snowCmHr: wx.snowCmHr,
    });
    captured.push(
      `${g.awayTeam.canonicalName} @ ${g.homeTeam.canonicalName}: ` +
        `${wx.tempF ?? "?"}°F, wind ${wx.windMph ?? "?"} (gust ${wx.windGustMph ?? "?"}), ` +
        `precip ${wx.precipProb ?? "?"}%`
    );
  }

  if (rows.length > 0) await prisma.weather.createMany({ data: rows });

  console.log("============================================================");
  console.log(`Weather rows inserted: ${rows.length} / ${games.length} games`);
  console.log(`  indoor (skipped):     ${indoor}`);
  console.log(`  already played:       ${played}`);
  console.log(`  no venue coords:      ${noCoords}`);
  console.log(`  beyond 16-day window: ${tooFarOut}`);
  console.log("============================================================\n");
  for (const c of captured) console.log("  " + c);

  if (tooFarOut > 0) {
    console.log(
      `\n${tooFarOut} game(s) are too far out for a forecast — re-run this closer to kickoff.`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
