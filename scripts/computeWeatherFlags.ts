// ============================================================
// Weather situational flags
// ============================================================
// Turns the latest Weather snapshot for each outdoor game into
// GameFlag rows: heat / cold / wind / rain / snow — only when the
// forecast at kickoff is genuinely extreme for football. These are
// heads-up "notable conditions" chips, not pick corroborators
// (weather is already in the totals model; see the guide §3–4).
//
// Attached to the HOME team as a stand-in for "this game" — weather
// hits both sides. Display + board only; not graded, not a pick
// signal. Wipes and recomputes its own flag types. No API calls.
//
// Run:  npm run compute-weather-flags
//       npm run compute-weather-flags -- --season 2026 --week 3
//       npm run compute-weather-flags -- --all
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";

const prisma = new PrismaClient();

// Thresholds — what counts as "extreme" for a football game. Heat/cold key off
// the "feels like" apparent temperature (heat index + wind chill), which is what
// actually matters on the field. Tuned so a flag fires on a handful of games a
// week early/late, not a third of the slate.
const HEAT_FEELS_F = 100; // feels-like; ~a few Sept noon kicks in the South
const HEAT_TEMP_F = 99; // fallback when feels-like is missing
const COLD_FEELS_F = 15;
const COLD_TEMP_F = 18;
const WIND_MPH = 20; // sustained — passing + kicking clearly affected
const GUST_MPH = 35;
const RAIN_MM_HR = 3.0; // steady moderate rain or heavier
const SNOW_CM_HR = 0.5; // moderate snowfall
const SNOW_TEMP_F = 33; // ...or near-freezing with a high precip chance
const SNOW_PRECIP_PCT = 60;

const WEATHER_FLAG_TYPES = ["heat", "cold", "wind", "rain", "snow"];

function parseArgs(): { season?: number; week?: number; all: boolean } {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const season = val("--season");
  const week = val("--week");
  const all = args.includes("--all");
  if (!all && ((season && !week) || (!season && week))) {
    console.error("Pass --season AND --week together, --all, or neither. Stopping.");
    process.exit(1);
  }
  return { season: season ? Number(season) : undefined, week: week ? Number(week) : undefined, all };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const o = parseArgs();
  const current = await getCurrentSeasonWeek();
  const season = o.season ?? current.season;
  const weeks = o.all ? null : [o.week ?? current.week];

  console.log(
    o.all
      ? `Weather flags — FULL ${season} season\n`
      : `Weather flags — season ${season}, week ${weeks![0]}\n`
  );

  const games = await prisma.game.findMany({
    where: { season, ...(weeks ? { week: { in: weeks } } : {}), indoor: false },
    select: {
      id: true, week: true, homeTeamId: true,
      homeTeam: { select: { canonicalName: true } },
      awayTeam: { select: { canonicalName: true } },
      weather: { orderBy: { pulledAt: "desc" }, take: 1 },
    },
  });

  const rows: Prisma.GameFlagCreateManyInput[] = [];
  const add = (
    gameId: string,
    teamId: string,
    flagType: string,
    detail: Prisma.InputJsonValue
  ) => rows.push({ gameId, teamId, flagType, detail });

  const counts: Record<string, number> = { heat: 0, cold: 0, wind: 0, rain: 0, snow: 0 };
  const examples: string[] = [];

  for (const g of games) {
    const w = g.weather[0];
    if (!w) continue;
    const label = `wk${g.week} ${g.awayTeam.canonicalName} @ ${g.homeTeam.canonicalName}`;
    const hit: string[] = [];
    const feels = w.feelsF ?? w.tempF;

    const isHeat =
      (w.feelsF != null && w.feelsF >= HEAT_FEELS_F) ||
      (w.feelsF == null && w.tempF != null && w.tempF >= HEAT_TEMP_F);
    if (isHeat) {
      add(g.id, g.homeTeamId, "heat", {
        tempF: w.tempF != null ? r1(w.tempF) : null,
        feelsLike: feels != null ? r1(feels) : null,
        humidityPct: w.humidityPct != null ? Math.round(w.humidityPct) : null,
      });
      counts.heat++; hit.push(`heat feels ${feels != null ? r1(feels) : "?"}°F`);
    }

    const isCold =
      (w.feelsF != null && w.feelsF <= COLD_FEELS_F) ||
      (w.feelsF == null && w.tempF != null && w.tempF <= COLD_TEMP_F);
    if (isCold) {
      add(g.id, g.homeTeamId, "cold", {
        tempF: w.tempF != null ? r1(w.tempF) : null,
        feelsLike: feels != null ? r1(feels) : null,
      });
      counts.cold++; hit.push(`cold feels ${feels != null ? r1(feels) : "?"}°F`);
    }

    if ((w.windMph != null && w.windMph >= WIND_MPH) || (w.windGustMph != null && w.windGustMph >= GUST_MPH)) {
      add(g.id, g.homeTeamId, "wind", {
        windMph: w.windMph != null ? r1(w.windMph) : null,
        gustMph: w.windGustMph != null ? r1(w.windGustMph) : null,
      });
      counts.wind++; hit.push(`wind ${w.windMph != null ? r1(w.windMph) : "?"}${w.windGustMph != null ? `/g${r1(w.windGustMph)}` : ""}`);
    }

    if (w.rainMmHr != null && w.rainMmHr >= RAIN_MM_HR && (w.tempF == null || w.tempF > 36)) {
      add(g.id, g.homeTeamId, "rain", {
        rateMmHr: r1(w.rainMmHr),
        precipProb: w.precipProbability != null ? Math.round(w.precipProbability) : null,
      });
      counts.rain++; hit.push(`rain ${r1(w.rainMmHr)}mm/h`);
    }

    const snowByRate = w.snowCmHr != null && w.snowCmHr >= SNOW_CM_HR;
    const snowByCond =
      w.tempF != null && w.tempF <= SNOW_TEMP_F &&
      w.precipProbability != null && w.precipProbability >= SNOW_PRECIP_PCT &&
      (w.rainMmHr ?? 0) < 1;
    if (snowByRate || snowByCond) {
      add(g.id, g.homeTeamId, "snow", {
        rateCmHr: w.snowCmHr != null ? r1(w.snowCmHr) : null,
        tempF: w.tempF != null ? r1(w.tempF) : null,
      });
      counts.snow++; hit.push(`snow ${w.snowCmHr != null ? r1(w.snowCmHr) + "cm/h" : "(cond)"}`);
    }

    if (hit.length && examples.length < 12) examples.push(`${label}: ${hit.join(", ")}`);
  }

  const scopeIds = games.map((g) => g.id);
  const deleted = await prisma.gameFlag.deleteMany({
    where: { gameId: { in: scopeIds }, flagType: { in: WEATHER_FLAG_TYPES } },
  });
  if (rows.length) await prisma.gameFlag.createMany({ data: rows });

  console.log("============================================================");
  console.log(`Outdoor games in scope: ${games.length} (${games.filter((g) => g.weather.length).length} with a forecast)`);
  console.log(`GameFlag rows: removed ${deleted.count}, inserted ${rows.length}`);
  console.log("------------------------------------------------------------");
  for (const k of WEATHER_FLAG_TYPES) console.log(`  ${k.padEnd(6)} ${counts[k]}`);
  console.log("============================================================\n");
  for (const e of examples) console.log("  " + e);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
