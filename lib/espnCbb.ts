// ============================================================
// ESPN men's college basketball scoreboard (free, no key)
// ============================================================
// The daily schedule + scores source for CBB. groups=50 = all of D-I,
// including D-I vs non-D-I games. Teams are matched by ESPN's numeric team
// id (CollegeBasketballData's team `sourceId` IS that id), so the schedule
// never depends on name matching.
// ============================================================

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

/** CBB season label: the 2026-27 season is 2027 (CollegeBasketballData's convention). */
export function cbbSeason(d: Date = new Date()): number {
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

/** "YYYYMMDD" for a date as seen in US Central time. */
export function centralYmd(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

export interface EspnCbbTeam {
  espnId: number;
  displayName: string; // "Florida State Seminoles"
  location: string | null; // "Florida State"
  abbreviation: string | null;
  logo: string | null;
  color: string | null;
}

export interface EspnCbbGame {
  espnId: number;
  startTime: Date;
  neutralSite: boolean;
  status: "scheduled" | "live" | "final" | "postponed" | "canceled";
  home: EspnCbbTeam & { score: number | null };
  away: EspnCbbTeam & { score: number | null };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapStatus(t: any): EspnCbbGame["status"] {
  const name = String(t?.name ?? "");
  if (name.includes("POSTPONED")) return "postponed";
  if (name.includes("CANCELED") || name.includes("CANCELLED")) return "canceled";
  if (t?.completed) return "final";
  if (t?.state === "in") return "live";
  return "scheduled";
}

function mapSide(c: any): EspnCbbTeam & { score: number | null } {
  const t = c.team ?? {};
  const score = c.score == null || c.score === "" ? null : Number(c.score);
  return {
    espnId: Number(t.id),
    displayName: String(t.displayName ?? t.name ?? t.id),
    location: t.location ?? null,
    abbreviation: t.abbreviation ?? null,
    logo: t.logo ?? null,
    color: t.color ?? null,
    score: Number.isFinite(score) ? score : null,
  };
}

/** All D-I games ESPN lists for one date ("YYYYMMDD"). */
export async function fetchCbbScoreboard(ymd: string): Promise<EspnCbbGame[]> {
  const res = await fetch(`${SCOREBOARD}?dates=${ymd}&groups=50&limit=400`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ESPN CBB scoreboard ${ymd} -> ${res.status}`);
  const j: any = await res.json();
  const out: EspnCbbGame[] = [];
  for (const e of j.events ?? []) {
    const c = e.competitions?.[0];
    if (!c) continue;
    const home = c.competitors?.find((x: any) => x.homeAway === "home");
    const away = c.competitors?.find((x: any) => x.homeAway === "away");
    if (!home || !away) continue;
    out.push({
      espnId: Number(e.id),
      startTime: new Date(c.date ?? e.date),
      neutralSite: Boolean(c.neutralSite),
      status: mapStatus(c.status?.type ?? e.status?.type),
      home: mapSide(home),
      away: mapSide(away),
    });
  }
  return out;
}
