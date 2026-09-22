// Prototype: a Gantt/broadcast-schedule style view of the same watch-guide
// data as /watch, inspired by cfb.guide's TV grid — one horizontal bar per
// game, positioned by actual kickoff time, so overlaps are visible at a
// glance instead of only seeing "the current best 4." Separate route on
// purpose: /watch (the quadbox planner) is untouched, this is a mockup to
// compare against before deciding whether either replaces or joins it.
import { currentSeason, currentWeek, weeksWithGames } from "../../lib/currentWeek";
import { getWeekBoard } from "../../lib/webData";
import { getLiveScores, type LiveGame } from "../../lib/liveScores";
import {
  getRivalryPairs,
  toWatchGame,
  GAME_DURATION_MS,
  CLUSTER_GAP_MS,
  type WatchGame,
} from "../../lib/watchGuide";

/** Group games into kickoff "waves" (same clustering rule as the quadbox
 *  windows — kickoffs within CLUSTER_GAP_MS share one), then rank by
 *  watchability WITHIN each wave only. Rows stay in chronological order
 *  top-to-bottom overall; only the ordering inside a shared timeslot
 *  reflects the score, so a 10pm game never jumps above an 11am one. */
function sortByWaveThenScore(games: WatchGame[]): WatchGame[] {
  const byKick = [...games].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const out: WatchGame[] = [];
  let wave: WatchGame[] = [];
  let waveStart = -Infinity;
  const flush = () => {
    out.push(...wave.sort((a, b) => b.score - a.score));
    wave = [];
  };
  for (const g of byKick) {
    const k = Date.parse(g.kickoff);
    if (wave.length && k - waveStart > CLUSTER_GAP_MS) flush();
    if (!wave.length) waveStart = k;
    wave.push(g);
  }
  flush();
  return out;
}
import { teamShort } from "../../components/ui";
import { WatchAutoRefresh } from "../../components/WatchAutoRefresh";

export const metadata = { title: "Watch timeline (prototype) · the yahngorithm" };

const LABEL_W = 172; // px — sticky left column
const PX_PER_HOUR = 110;
const ROW_H = 68; // taller than a 2-line label to also fit the kickoff time

const ctDateKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const ctDateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
const hourLabel = (ms: number) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    timeZone: "America/Chicago",
  }).formatToParts(new Date(ms));
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const ap = parts.find((p) => p.type === "dayPeriod")?.value.toLowerCase()[0] ?? "";
  return `${h}${ap}`;
};
/** compact kickoff time for the label column, e.g. "6:30p" — same
 *  single-letter am/pm convention as hourLabel() for visual consistency. */
const kickTimeLabel = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Chicago",
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "";
  const ap = parts.find((p) => p.type === "dayPeriod")?.value.toLowerCase()[0] ?? "";
  return `${h}:${m}${ap}`;
};

export default async function WatchTimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; day?: string }>;
}) {
  const season = currentSeason();
  const sp = await searchParams;
  const thisWeek = await currentWeek(season);
  const parsedWeek = Number(sp.week);
  const week =
    sp.week && Number.isInteger(parsedWeek) && parsedWeek >= 1 && parsedWeek <= 25
      ? parsedWeek
      : thisWeek;

  const [board, weeks, rivalryPairs] = await Promise.all([
    getWeekBoard(season, week),
    weeksWithGames(season),
    getRivalryPairs(),
  ]);
  const rivalryMap = new Map(rivalryPairs.map((p) => [p.key, p.name]));

  const prev = weeks.filter((w) => w < week).pop() ?? null;
  const next = weeks.find((w) => w > week) ?? null;
  const qs = (o: { week?: number; day?: string }) => {
    const p = new URLSearchParams();
    if (o.week != null) p.set("week", String(o.week));
    if (o.day) p.set("day", o.day);
    const s = p.toString();
    return s ? `/watch-timeline?${s}` : "/watch-timeline";
  };

  const byDay = new Map<string, typeof board>();
  for (const g of board) {
    const k = ctDateKey(g.kickoff);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(g);
  }
  const days = [...byDay.keys()].sort();

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const defaultDay =
    days.find((d) => d === today) ??
    days.find((d) => d >= today) ??
    [...days].sort((a, b) => (byDay.get(b)!.length - byDay.get(a)!.length))[0] ??
    null;
  const day = sp.day && byDay.has(sp.day) ? sp.day : defaultDay;
  const dayGames = day ? byDay.get(day)! : [];

  const yesterday = new Date(Date.now() - 24 * 3600_000).toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
  const live: Map<string, LiveGame> =
    day && (day === today || day === yesterday)
      ? await getLiveScores(
          dayGames.map((g) => ({ id: g.id, home: g.home, away: g.away })),
          day
        )
      : new Map();

  // chronological wave-by-wave, most-watchable first WITHIN each wave —
  // re-sorts on every refresh as live scores move (see WatchAutoRefresh
  // below), so rows can reorder, but only relative to their own timeslot.
  const games: WatchGame[] = sortByWaveThenScore(
    dayGames.map((g) => toWatchGame(g, rivalryMap, live.get(g.id) ?? null))
  );

  const now = Date.now();
  const anyLive = [...live.values()].some((l) => l.state === "in");
  const kickingSoon = dayGames.some((g) => {
    const dt = Date.parse(g.kickoff) - now;
    return dt > -4 * 3600_000 && dt < 45 * 60_000;
  });
  const refreshActive = anyLive || kickingSoon;

  let body: React.ReactNode = <p className="empty">No games on this day.</p>;
  if (games.length > 0) {
    const kicks = games.map((g) => Date.parse(g.kickoff));
    const dayStart = Math.floor(Math.min(...kicks) / 3_600_000) * 3_600_000;
    const dayEndRaw = Math.max(...kicks) + GAME_DURATION_MS;
    const dayEnd = Math.ceil(dayEndRaw / 3_600_000) * 3_600_000;
    const hours = Math.round((dayEnd - dayStart) / 3_600_000);
    const trackW = hours * PX_PER_HOUR;
    const bodyW = LABEL_W + trackW;
    const bodyH = games.length * ROW_H;
    const toX = (ms: number) => LABEL_W + ((ms - dayStart) / 3_600_000) * PX_PER_HOUR;

    const hourMarks = Array.from({ length: hours + 1 }, (_, i) => {
      const ms = dayStart + i * 3_600_000;
      return { ms, x: toX(ms) };
    });

    const nowX = now >= dayStart && now <= dayEnd ? toX(now) : null;

    body = (
      <div className="tl-scroll">
        <div className="tl-body" style={{ width: bodyW }}>
          <div className="tl-hours">
            {hourMarks.map((h) => (
              <span key={h.ms} className="tl-hour" style={{ left: h.x }}>
                {hourLabel(h.ms)}
              </span>
            ))}
          </div>
          {hourMarks.map((h) => (
            <div key={h.ms} className="tl-gridline" style={{ left: h.x, height: bodyH }} />
          ))}
          {nowX != null && (
            <div className="tl-nowline" style={{ left: nowX, height: bodyH }}>
              <span className="tl-nowdot" />
            </div>
          )}

          {games.map((g) => {
            const kickMs = Date.parse(g.kickoff);
            const left = toX(kickMs);
            const width = (Math.min(GAME_DURATION_MS, dayEnd - kickMs) / 3_600_000) * PX_PER_HOUR;
            const heat = Math.max(0, Math.min(100, g.score));
            const bg = `color-mix(in srgb, var(--amber) ${Math.round(8 + heat * 0.72)}%, var(--panel-2))`;
            const isLive = g.status === "in";
            const isFinal = g.status === "final";

            return (
              <div key={g.id} className="tl-row" style={{ height: ROW_H }}>
                <div className="tl-label">
                  <div className="tl-label-time">
                    {g.status === "final" ? "final" : kickTimeLabel(g.kickoff)}
                    {isLive && <span className="tl-live-dot" />}
                  </div>
                  <div className="tl-label-row">
                    {g.away.logo ? (
                      <img className="tl-logo" src={g.away.logo} alt="" />
                    ) : (
                      <span className="tl-logo" style={{ background: g.away.color ?? "var(--border)" }} />
                    )}
                    <span className="tl-label-name">{teamShort(g.away)}</span>
                    {g.awayScore != null && <span className="tl-label-score">{g.awayScore}</span>}
                  </div>
                  <div className="tl-label-row">
                    {g.home.logo ? (
                      <img className="tl-logo" src={g.home.logo} alt="" />
                    ) : (
                      <span className="tl-logo" style={{ background: g.home.color ?? "var(--border)" }} />
                    )}
                    <span className="tl-label-name">{teamShort(g.home)}</span>
                    {g.homeScore != null && <span className="tl-label-score">{g.homeScore}</span>}
                  </div>
                </div>
                <a
                  href={`/game/${g.id}`}
                  className={`tl-bar${isLive ? " is-live" : ""}${isFinal ? " is-final" : ""}`}
                  style={{ left, width, background: bg }}
                  title={g.reasons.join(" · ")}
                >
                  {isLive && <span className="tl-live-dot" />}
                  <span className="tl-bar-score">{g.score}</span>
                  <span className="tl-bar-reason">{g.reasons[0]}</span>
                </a>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <h1>Watch timeline (prototype)</h1>
      <p className="subhead">
        Same watchability scoring as the{" "}
        <a href={`/watch${sp.week ? `?week=${week}` : ""}`} className="inline-link" style={{ color: "var(--blue)" }}>
          quadbox guide
        </a>
        , shown as a broadcast-schedule timeline instead — one bar per game,
        positioned by kickoff, colored by score. Bar length is a fixed
        ~3h40m estimate, not an actual final time. Tap a bar for the game
        page; hover for the top reason. Rows stay in chronological order —
        within each kickoff timeslot, the most watchable game sorts to the
        top, and that shifts as live scores move.
      </p>

      {refreshActive && (
        <WatchAutoRefresh active={refreshActive} renderedAt={now} intervalSec={60} />
      )}

      <div className="weeknav">
        <div className="weeknav-ctl">
          {prev != null ? (
            <a href={qs({ week: prev })} aria-label={`week ${prev}`}>‹</a>
          ) : (
            <span className="off" aria-hidden>‹</span>
          )}
          <span className="weeknav-cur">
            Week {week}
            <span className="yr">· {season}</span>
          </span>
          {next != null ? (
            <a href={qs({ week: next })} aria-label={`week ${next}`}>›</a>
          ) : (
            <span className="off" aria-hidden>›</span>
          )}
        </div>
        {week !== thisWeek && (
          <a href={qs({})} className="weeknav-jump">↩ this week ({thisWeek})</a>
        )}
      </div>

      {days.length > 0 && (
        <div className="sort-toggle watch-daytabs">
          {days.map((d) => (
            <a
              key={d}
              href={qs({ week: sp.week ? week : undefined, day: d })}
              className={d === day ? "on" : ""}
            >
              {ctDateLabel(byDay.get(d)![0].kickoff)}
              <span className="n"> ({byDay.get(d)!.length})</span>
            </a>
          ))}
        </div>
      )}

      <div className="tl-legend">
        <span>watchability</span>
        <span className="tl-legend-bar" />
        <span className="tl-legend-lo">low</span>
        <span className="tl-legend-hi">high</span>
      </div>

      {body}
    </>
  );
}
