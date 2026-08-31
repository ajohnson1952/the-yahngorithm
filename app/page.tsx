import { currentSeason, currentWeek, weeksWithGames } from "../lib/currentWeek";
import { getWeekBoard } from "../lib/webData";
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
  const week = sp.week ? Number(sp.week) : thisWeek;
  const byTime = sp.sort === "time";

  const [board, weeks] = await Promise.all([
    getWeekBoard(season, week),
    weeksWithGames(season),
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

  // ---- build the sections ----
  let sections: { label: string; games: typeof board }[];
  if (byTime) {
    const byDay = new Map<string, typeof board>();
    const ordered = [...board].sort(
      (a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)
    );
    for (const g of ordered) {
      const k = dayLabel(g.kickoff);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(g);
    }
    sections = [...byDay.entries()].map(([label, games]) => ({ label, games }));
  } else {
    const groups = new Map<number, typeof board>();
    for (const g of board) {
      (groups.get(g.sortRank) ?? groups.set(g.sortRank, []).get(g.sortRank)!).push(
        g
      );
    }
    sections = [0, 1, 2, 3, 4, 6]
      .filter((r) => groups.get(r)?.length)
      .map((r) => ({ label: RANK_LABEL[r], games: groups.get(r)! }));
  }

  return (
    <>
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
      </div>

      <div className="board-controls">
        <p className="subhead" style={{ margin: 0 }}>
          {board.length} games ·{" "}
          {pickCount === 0
            ? "no picks this week"
            : `${pickCount} pick${pickCount > 1 ? "s" : ""} logged`}
        </p>
        <div className="sort-toggle">
          <a
            href={qs({ week: sp.week ? week : undefined })}
            className={byTime ? "" : "on"}
          >
            By edge
          </a>
          <a
            href={qs({ week: sp.week ? week : undefined, sort: "time" })}
            className={byTime ? "on" : ""}
          >
            By kickoff
          </a>
        </div>
      </div>

      {sections.map((s) => (
        <section key={s.label}>
          <div className="section-label">{s.label}</div>
          {s.games.map((g) => (
            <GameCard key={g.id} g={g} />
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
