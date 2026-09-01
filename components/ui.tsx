import type { FlagView, TeamLite } from "../lib/webData";

export const HURT_FLAGS = new Set([
  "short_week",
  "travel",
  "lookahead",
  "letdown",
  "rlm",
  "bad_spot",
]);
export const HELP_FLAGS = new Set(["off_bye", "revenge", "steam"]);
export const MARKET_FLAGS = new Set(["rlm", "steam"]);
export const SPOT_FLAGS = new Set(["bad_spot"]);
export const WEATHER_FLAGS = new Set(["heat", "cold", "wind", "rain", "snow"]);

const FLAG_LABEL: Record<string, string> = {
  short_week: "short week",
  off_bye: "off bye",
  travel: "travel",
  revenge: "revenge",
  lookahead: "lookahead",
  letdown: "letdown",
  bad_spot: "bad spot",
  rlm: "reverse line move",
  steam: "steam",
  wind: "wind",
  slow_pace: "slow pace",
  fast_pace: "fast pace",
  heat: "extreme heat",
  cold: "extreme cold",
  rain: "heavy rain",
  snow: "snow",
};

export const FLAG_MEANING: Record<string, string> = {
  short_week:
    "Fewer than 6 days since this team's previous game. Less practice and recovery — a small negative, more so if they also traveled.",
  off_bye:
    "A skipped week on the schedule (a true bye). Extra prep time — usually a small positive, especially for the better-coached team and for underdogs.",
  travel:
    "Home stadium is 1,200+ miles from the venue, or the body-clock timezone shift is 2+ hours. A documented small drag on the traveling team.",
  revenge:
    "Lost the last meeting (within 2 seasons) in a rivalry or by ≤10 points, and this year's game projects within 14. The \"one that got away\" angle — modest, partly priced in.",
  lookahead:
    "Decent team favored by 13+ this week, with a rivalry or tough opponent (within ~6) next week. Classic trap — fade this team / take the points.",
  letdown:
    "Won an emotional game last week (rivalry or within 3 SP+ pts) and this week's opponent is 10+ SP+ pts weaker. Emotional hangover — fade this team / take the points.",
  bad_spot:
    "Two or more situational negatives stacked on this team (e.g. a long trip on a short week, or a letdown spot after a long trip). Backtests ~57% ATS on the fade — a decision aid, not a lock. Take the points against this team.",
  rlm:
    "The book's number moved toward this team while the Kalshi prediction market (real money, no vig) moved the other way, on a market with real volume. The public is on this team; the sharp market isn't. Lean the other side.",
  steam:
    "The consensus spread made a fast, synchronized move toward this team across the books — a sign real money came in on them quickly.",
  heat:
    "Kickoff \"feels like\" 100°F+ (heat index — and the field runs hotter still). Second-half legs and depth matter more; offenses tend to bog down late. Small lean UNDER. Affects both teams.",
  cold:
    "Kickoff \"feels like\" 15°F or below (wind chill). Ball is harder to catch and kick, field-goal range shrinks — favors the run and the UNDER, and the cold-weather side over a warm-weather visitor.",
  wind:
    "Sustained wind 18+ mph or gusts 30+. The single biggest weather factor: passing and especially kicking suffer. Leans UNDER; a shootout script is unlikely. Affects both teams.",
  rain:
    "Steady, moderate-or-heavier rain at kickoff. Fumbles up, passing efficiency down — favors the run, the more physical team, and the UNDER. Explosive plays get dampened.",
  snow:
    "Snow falling at kickoff (or near-freezing with a high precip chance). The highest-variance weather: big UNDER pressure, kicking chaos, ball-security problems. Often the points with the dog. Affects both teams.",
};

export function flagDetail(flagType: string, detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  switch (flagType) {
    case "short_week":
    case "off_bye":
      return d.daysRest != null ? `${d.daysRest}d rest` : "";
    case "travel":
      return [
        d.distanceMiles != null ? `${d.distanceMiles} mi` : "",
        d.tzChange ? `${d.tzChange}h` : "",
      ]
        .filter(Boolean)
        .join(", ");
    case "revenge":
      return `lost by ${d.lostBy}${d.wasRivalry ? " (rivalry)" : ""}`;
    case "lookahead":
      return `then ${d.nextOpponent}`;
    case "letdown":
      return `beat ${d.lastWeekBeat}`;
    case "bad_spot":
      return Array.isArray(d.flags)
        ? (d.flags as string[]).map((f) => FLAG_LABEL[f] ?? f).join(" + ")
        : "";
    case "rlm":
      return [
        d.bookMovePts != null ? `book ${d.bookMovePts}` : "",
        d.volume != null ? `${d.volume} vol` : "",
      ]
        .filter(Boolean)
        .join(", ");
    case "steam":
      return [
        d.movePts != null ? `${d.movePts} pts` : "",
        d.hours != null ? `in ${d.hours}h` : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "heat":
    case "cold": {
      const t = d.tempF != null ? `${Math.round(Number(d.tempF))}°F` : "";
      const f =
        d.feelsLike != null && Math.round(Number(d.feelsLike)) !== Math.round(Number(d.tempF))
          ? `feels ${Math.round(Number(d.feelsLike))}°`
          : "";
      const h = d.humidityPct != null ? `${d.humidityPct}% RH` : "";
      return [t, f, h].filter(Boolean).join(", ");
    }
    case "wind":
      return [
        d.windMph != null ? `${Math.round(Number(d.windMph))} mph` : "",
        d.gustMph != null ? `gust ${Math.round(Number(d.gustMph))}` : "",
      ]
        .filter(Boolean)
        .join(", ");
    case "rain":
      return d.rateMmHr != null ? `${d.rateMmHr} mm/hr` : "";
    case "snow":
      return d.rateCmHr != null
        ? `${d.rateCmHr} cm/hr`
        : d.tempF != null
          ? `${Math.round(Number(d.tempF))}°F`
          : "";
    default:
      return "";
  }
}

export function FlagChip({
  flag,
  showTeam,
}: {
  flag: FlagView;
  showTeam?: boolean;
}) {
  const isWeather = WEATHER_FLAGS.has(flag.flagType);
  const cls = SPOT_FLAGS.has(flag.flagType)
    ? "spot"
    : MARKET_FLAGS.has(flag.flagType)
      ? "mkt"
      : isWeather
        ? "wx"
        : HURT_FLAGS.has(flag.flagType)
          ? "hurt"
          : HELP_FLAGS.has(flag.flagType)
            ? "help"
            : "wx";
  const det = flagDetail(flag.flagType, flag.detail);
  // weather hits both sides — never tag it to one team
  return (
    <span
      className={`chip ${cls}`}
      title={isWeather ? det : `${flag.team}${det ? ` — ${det}` : ""}`}
    >
      {showTeam && !isWeather ? `${flag.teamAbbr ?? abbrevTeam(flag.team)} ` : ""}
      {FLAG_LABEL[flag.flagType] ?? flag.flagType}
    </span>
  );
}

export function PickFlagChip({ label }: { label: string }) {
  const cls = HELP_FLAGS.has(label) ? "help" : HURT_FLAGS.has(label) ? "hurt" : "wx";
  return <span className={`chip ${cls}`}>{FLAG_LABEL[label] ?? label}</span>;
}

/** e.g. -6.5 -> "-6.5", 0 -> "PK", 3 -> "+3" */
export function spreadStr(n: number): string {
  if (Math.abs(n) < 0.01) return "PK";
  return n > 0 ? `+${trim(n)}` : `${trim(n)}`;
}
export function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
export function signed(n: number): string {
  return n > 0 ? `+${trim(n)}` : trim(n);
}

/** all game times shown in US Central. */
export function kickoffStr(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Chicago",
    }) + " CT"
  );
}

/** short timestamp (for line/weather history), US Central. */
export function stampCT(d: string | Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

/** betting-style short name for tight spots: the stored abbreviation, else a
 *  trimmed canonical name. */
export function teamShort(t: { abbr: string | null; name: string }): string {
  return t.abbr ?? abbrevTeam(t.name);
}

export function abbrevTeam(name: string): string {
  return name.length > 14 ? name.slice(0, 13) + "…" : name;
}

export function TeamRow({
  team,
  score,
  won,
}: {
  team: TeamLite;
  score?: number | null;
  won?: boolean;
}) {
  return (
    <div className="team-row">
      {team.logo ? (
        <img className="team-logo" src={team.logo} alt="" loading="lazy" />
      ) : (
        <span
          className="team-logo"
          style={{
            background: team.color ?? "var(--border)",
            borderRadius: 4,
          }}
        />
      )}
      <span className="team-name">
        {team.apRank != null && <span className="ap-rank">{team.apRank}</span>}
        {team.name}
        {team.conference && <span className="conf">{team.conference}</span>}
        {team.classification !== "fbs" && (
          <span className="conf tag-fcs">{team.classification.toUpperCase()}</span>
        )}
      </span>
      {score != null && (
        <span className={`team-score${won ? " win" : ""}`}>{score}</span>
      )}
    </div>
  );
}
