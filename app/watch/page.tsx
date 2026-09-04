import { currentSeason, currentWeek, weeksWithGames } from "../../lib/currentWeek";
import { getWeekBoard } from "../../lib/webData";
import {
  getRivalryPairs,
  toWatchGame,
  buildWatchWindows,
  QUADBOX_SIZE,
  type WatchGame,
} from "../../lib/watchGuide";
import { WatchCard } from "../../components/WatchCard";

export const metadata = { title: "Watch guide · the yahngorithm" };

const ctDateKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const ctDateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
const windowLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }) + " CT";

export default async function WatchPage({
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
    return s ? `/watch?${s}` : "/watch";
  };

  // group into calendar days (CT)
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
  const watchGames: WatchGame[] = dayGames
    .map((g) => toWatchGame(g, rivalryMap))
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const windows = buildWatchWindows(watchGames);

  const now = Date.now();
  const nowWindowIdx = windows.findIndex((w, i) => {
    const start = Date.parse(w.start);
    const end = windows[i + 1] ? Date.parse(windows[i + 1].start) : Infinity;
    return now >= start && now < end;
  });

  return (
    <>
      <h1>Watch guide</h1>
      <p className="subhead">
        A quadbox plan for the day — the {QUADBOX_SIZE} best games to have on at
        every point, ranked by projected competitiveness, pace, ranked-team
        stakes, and rivalries. Built from pregame data (lines, ratings,
        rankings), not live scores — plan your day with it, don&apos;t expect
        it to re-shuffle mid-game.
      </p>

      <div className="weeknav">
        <div className="weeknav-ctl">
          {prev != null ? (
            <a href={qs({ week: prev })} aria-label={`week ${prev}`}>
              ‹
            </a>
          ) : (
            <span className="off" aria-hidden>
              ‹
            </span>
          )}
          <span className="weeknav-cur">
            Week {week}
            <span className="yr">· {season}</span>
          </span>
          {next != null ? (
            <a href={qs({ week: next })} aria-label={`week ${next}`}>
              ›
            </a>
          ) : (
            <span className="off" aria-hidden>
              ›
            </span>
          )}
        </div>
        {week !== thisWeek && (
          <a href={qs({})} className="weeknav-jump">
            ↩ this week ({thisWeek})
          </a>
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

      {watchGames.length === 0 ? (
        <p className="empty">No games loaded for this week yet.</p>
      ) : windows.length === 0 ? (
        <p className="empty">No games on this day.</p>
      ) : (
        <>
          <p className="watch-summary">
            {watchGames.length} game{watchGames.length === 1 ? "" : "s"} ·{" "}
            {windows.length} viewing window{windows.length === 1 ? "" : "s"}
          </p>
          {windows.map((w, i) => (
            <section key={w.start} className="watch-window">
              <div className="watch-window-head">
                <span className="watch-window-time">{windowLabel(w.start)}</span>
                {i === nowWindowIdx && <span className="watch-now">now</span>}
                {w.lineup.length < QUADBOX_SIZE && (
                  <span className="watch-window-note">
                    {w.lineup.length} of {QUADBOX_SIZE} slots — that&apos;s everything live
                  </span>
                )}
              </div>
              {(w.added.length > 0 || w.dropped.length > 0) && i > 0 && (
                <div className="watch-swap">
                  {w.dropped.length > 0 && (
                    <span>
                      out: {w.dropped.map((g) => g.away.abbr ?? g.away.name).join(", ")}
                    </span>
                  )}
                  {w.added.length > 0 && (
                    <span>
                      in: {w.added.map((g) => g.away.abbr ?? g.away.name).join(", ")}
                    </span>
                  )}
                </div>
              )}
              <div className="watch-lineup">
                {w.lineup.map((g, gi) => (
                  <WatchCard key={g.id} g={g} rank={gi + 1} />
                ))}
              </div>
              {w.bench.length > 0 && (
                <details className="watch-bench">
                  <summary>next best ({w.bench.length})</summary>
                  <div className="watch-lineup watch-lineup-bench">
                    {w.bench.map((g) => (
                      <WatchCard key={g.id} g={g} />
                    ))}
                  </div>
                </details>
              )}
            </section>
          ))}
        </>
      )}

      <p className="foot">
        Estimated ~3h40m per game and a 45-min kickoff-clustering window — real
        games run long or short. A window changes only when the top{" "}
        {QUADBOX_SIZE} by score actually changes, not on every kickoff.
      </p>
    </>
  );
}
