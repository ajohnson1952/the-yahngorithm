// ============================================================
// Open-Meteo weather helper  (free, no API key)
// ============================================================
// Forecast horizon is ~16 days. For a kickoff further out than that
// we return null — the brief says pull weather close to kickoff
// anyway (Saturday morning), this is just an early look.
// ============================================================

const BASE = "https://api.open-meteo.com/v1/forecast";
const MAX_FORECAST_DAYS = 16;

export interface HourlyWeather {
  tempF: number | null;
  precipProb: number | null;
  windMph: number | null;
  windGustMph: number | null;
}

/** Nearest-hour forecast for a venue at kickoff. null if beyond the horizon. */
export async function forecastAt(
  lat: number,
  lng: number,
  at: Date,
  now: Date = new Date()
): Promise<HourlyWeather | null> {
  const daysOut = (at.getTime() - now.getTime()) / 86_400_000;
  if (daysOut > MAX_FORECAST_DAYS) return null;
  const forecastDays = Math.min(
    MAX_FORECAST_DAYS,
    Math.max(1, Math.ceil(daysOut) + 1)
  );

  const url =
    `${BASE}?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC` +
    `&forecast_days=${forecastDays}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Open-Meteo -> ${res.status} ${res.statusText}`);
  }
  const j: any = await res.json();
  const times: string[] = j.hourly?.time ?? [];
  if (times.length === 0) return null;

  // index of the hour closest to kickoff (times are UTC ISO without a 'Z')
  const target = at.getTime();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(Date.parse(times[i] + "Z") - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  // if the closest hour is still >3h from kickoff, the horizon didn't reach it
  if (bestDiff > 3 * 3_600_000) return null;

  const at_ = <T,>(arr: T[] | undefined): T | null => arr?.[best] ?? null;
  return {
    tempF: at_(j.hourly.temperature_2m),
    precipProb: at_(j.hourly.precipitation_probability),
    windMph: at_(j.hourly.wind_speed_10m),
    windGustMph: at_(j.hourly.wind_gusts_10m),
  };
}
