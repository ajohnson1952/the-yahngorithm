import { currentSeason, currentWeek, weeksWithGames } from "../lib/currentWeek";
import { getWeekBoard } from "../lib/webData";
import { isAdmin } from "../lib/adminAuth";
import { GameCard } from "../components/GameCard";

export const dynamic = "force-dynamic";

const RANK_LABEL: Record<number, string> = {
  0: "Picks",
  1: "Edges worth a look (not corroborated — see the game page for why)",
  2: "Flagged games",
  3: "Big-favorite edges (model artifact — usually noise, see Guide §2)",
  4: "Everything else",
  6: "No model yet",
};

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; sort?: string }>;
}) {
  const season = currentSeason();
  const sp = await searchParams;
  const thisWeek = await currentWeek(season);
  // ?week= is user input — accept only a positive integer in a sane range,
  // otherwise fall back to the current week (a bad value would 500 at Prisma).
  const parsedWeek = Number(sp.week);
  const week =
    sp.week && Number.isInteger(parsedWeek) && parsedWeek >= 1 && parsedWeek <= 25
      ? parsedWeek
      : thisWeek;
  const byTime = sp.sort === "time";
  const badSpotOnly = sp.sort === "badspot";
  const pinnedOnly = sp.sort === "pinned";

  const [board, weeks, canPin] = await Promise.all([
    getWeekBoard(season, week),
    weeksWithGames(season),
    isAdmin(),
  ]);

  const prev = weeks.filter((w) => w < week).pop() ?? null;
  const next = weeks.find((w) => w > week) ?? null;
  const qs = (o: { week?: number; sort?: string }) => {
    const p = new URLSearchParams();
    if (o.week != null) p.set("week", String(o.week));
    if (o.sort) p.set("sort", o.sort);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  const pickCount = board.filter((g) => g.picks.length > 0).length;

  const hasBadSpot = (g: (typeof board)[number]) =>
    g.flags.some((f) => f.flagType === "bad_spot");
  const byKick = (a: (typeof board)[number], b: (typeof board)[number]) =>
    Date.parse(a.kickoff) - Date.parse(b.kickoff);

  // completed games always sink to their own section at the bottom
  const live = board.filter((g) => g.status !== "final");
  const done = board
    .filter((g) => g.status === "final")
    .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)); // newest first

  // ---- build the sections ----
  let sections: { label: string; games: typeof board }[];
  if (pinnedOnly) {
    const games = [...board].filter((g) => g.pinned).sort(byKick);
    sections = games.length
      ? [{ label: `Pinned games (${games.length})`, games }]
      : [];
  } else if (badSpotOnly) {
    const games = live.filter(hasBadSpot).sort(byKick);
    sections = games.length
      ? [{ label: `Bad-spot games (${games.length})`, games }]
      : [];
  } else if (byTime) {
    const byDay = new Map<string, typeof board>();
    for (const g of [...live].sort(byKick)) {
      const k = dayLabel(g.kickoff);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(g);
    }
    sections = [...byDay.entries()].map(([label, games]) => ({ label, games }));
  } else {
    const groups = new Map<number, typeof board>();
    for (const g of live) {
      (groups.get(g.sortRank) ?? groups.set(g.sortRank, []).get(g.sortRank)!).push(g);
    }
    sections = [0, 1, 2, 3, 4, 6]
      .filter((r) => groups.get(r)?.length)
      // within each edge group, sub-sort by kickoff time
      .map((r) => ({
        label: RANK_LABEL[r],
        games: [...groups.get(r)!].sort(byKick),
      }));
  }

  // trailing "Final" section (not on the filtered views)
  if (!badSpotOnly && !pinnedOnly && done.length) {
    sections.push({ label: `Final (${done.length})`, games: done });
  }

  return (
    <>
      <p className="board-meta">
        {board.length} game{board.length === 1 ? "" : "s"} ·{" "}
        {pickCount === 0
          ? "no picks this week"
          : `${pickCount} pick${pickCount > 1 ? "s" : ""} logged`}
      </p>

      <div className="weeknav">
        <div className="weeknav-ctl">
          {prev != null ? (
            <a href={qs({ week: prev, sort: sp.sort })} aria-label={`week ${prev}`}>
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
            <a href={qs({ week: next, sort: sp.sort })} aria-label={`week ${next}`}>
              ›
            </a>
          ) : (
            <span className="off" aria-hidden>
              ›
            </span>
          )}
        </div>
        {week !== thisWeek && (
          <a href={qs({ sort: sp.sort })} className="weeknav-jump">
            ↩ this week ({thisWeek})
          </a>
        )}
        <div className="sort-toggle">
          <a
            href={qs({ week: sp.week ? week : undefined })}
            className={!byTime && !badSpotOnly && !pinnedOnly ? "on" : ""}
          >
            By edge
          </a>
          <a
            href={qs({ week: sp.week ? week : undefined, sort: "time" })}
            className={byTime ? "on" : ""}
          >
            By kickoff
          </a>
          <a
            href={qs({ week: sp.week ? week : undefined, sort: "badspot" })}
            className={badSpotOnly ? "on" : ""}
          >
            Bad spots
          </a>
          <a
            href={qs({ week: sp.week ? week : undefined, sort: "pinned" })}
            className={pinnedOnly ? "on" : ""}
          >
            ★ Pinned
          </a>
        </div>
      </div>

      {badSpotOnly && sections.length === 0 && (
        <p className="empty">
          No bad-spot games this week — no team has 2+ situational flags stacked.
        </p>
      )}
      {pinnedOnly && sections.length === 0 && (
        <p className="empty">
          No pinned games. {canPin ? "Tap the ☆ on a card to pin it." : null}
        </p>
      )}

      {sections.map((s) => (
        <section key={s.label}>
          <div className="section-label">{s.label}</div>
          {s.games.map((g) => (
            <GameCard key={g.id} g={g} canPin={canPin} />
          ))}
        </section>
      ))}

      {board.length === 0 && (
        <p className="empty">No games loaded for this week yet.</p>
      )}

      <p className="foot">
        Decision support, not a guarantee. Read the{" "}
        <a href="/guide" className="inline-link" style={{ color: "var(--blue)" }}>
          interpretation guide
        </a>{" "}
        before acting on anything here.
      </p>
    </>
  );
}
