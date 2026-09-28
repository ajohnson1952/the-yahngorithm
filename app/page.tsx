import Link from "next/link";
import { cookies } from "next/headers";
import { currentSeason, currentWeek, weeksWithGames } from "../lib/currentWeek";
import { getWeekBoard, getPinnedGameIds } from "../lib/webData";
import { BoardView } from "../components/BoardView";

// The page itself still renders per request (it reads ?week=/?sort= and the
// yahn_uid cookie), but the expensive part — getWeekBoard's queries — is cached
// in the data layer keyed on (season, week). Pins are the only per-visitor bit
// and they come from a cheap uncached lookup layered on below.

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

type SP = Promise<{ week?: string; sort?: string }>;

// ?week= is user input — accept only a positive integer in a sane range,
// otherwise fall back to the current week (a bad value would 500 at Prisma).
function resolveWeek(raw: string | undefined, thisWeek: number): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 && n <= 25 ? n : thisWeek;
}

// "Week 5 · the yahngorithm" in the tab / home-screen switcher
export async function generateMetadata({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const week = resolveWeek(sp.week, await currentWeek(currentSeason()));
  return { title: `Week ${week} · the yahngorithm` };
}

export default async function Home({ searchParams }: { searchParams: SP }) {
  const season = currentSeason();
  const sp = await searchParams;
  const thisWeek = await currentWeek(season);
  const week = resolveWeek(sp.week, thisWeek);
  // default view is by kickoff; ?sort=edge for the edge groups, ?sort=pinned
  // for the watch list. (?sort=time still works — it's the default.)
  const byEdge = sp.sort === "edge";
  const pinnedOnly = sp.sort === "pinned";

  const uid = (await cookies()).get("yahn_uid")?.value ?? "";
  const [rawBoard, weeks, pins] = await Promise.all([
    getWeekBoard(season, week),
    weeksWithGames(season),
    getPinnedGameIds(uid),
  ]);
  const board = pins.size
    ? rawBoard.map((g) => (pins.has(g.id) ? { ...g, pinned: true } : g))
    : rawBoard;

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
  } else if (byEdge) {
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
  } else {
    // default: grouped by day
    const byDay = new Map<string, typeof board>();
    for (const g of [...live].sort(byKick)) {
      const k = dayLabel(g.kickoff);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(g);
    }
    sections = [...byDay.entries()].map(([label, games]) => ({ label, games }));
  }

  // trailing "Final" section (not on the pinned view)
  if (!pinnedOnly && done.length) {
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

      <div className="weeknav board-nav">
        <div className="weeknav-ctl">
          {prev != null ? (
            <Link href={qs({ week: prev, sort: sp.sort })} aria-label={`week ${prev}`}>
              ‹
            </Link>
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
            <Link href={qs({ week: next, sort: sp.sort })} aria-label={`week ${next}`}>
              ›
            </Link>
          ) : (
            <span className="off" aria-hidden>
              ›
            </span>
          )}
        </div>
        {week !== thisWeek && (
          <Link href={qs({ sort: sp.sort })} className="weeknav-jump">
            ↩ this week ({thisWeek})
          </Link>
        )}
        <div className="sort-toggle" aria-label="Sort">
          <Link
            href={qs({ week: sp.week ? week : undefined })}
            className={!byEdge && !pinnedOnly ? "on" : ""}
          >
            <span className="wide-only">By </span>kickoff
          </Link>
          <Link
            href={qs({ week: sp.week ? week : undefined, sort: "edge" })}
            className={byEdge ? "on" : ""}
          >
            <span className="wide-only">By </span>edge
          </Link>
          <Link
            href={qs({ week: sp.week ? week : undefined, sort: "pinned" })}
            className={pinnedOnly ? "on" : ""}
            aria-label="Pinned games"
          >
            ★<span className="wide-only"> Pinned</span>
          </Link>
        </div>
      </div>

      {pinnedOnly && sections.length === 0 && (
        <p className="empty">No pinned games. Tap the ☆ on a card to pin it.</p>
      )}

      <BoardView sections={sections} />

      {board.length === 0 && (
        <p className="empty">No games loaded for this week yet.</p>
      )}

      <p className="foot">
        Decision support, not a guarantee. Read the{" "}
        <Link href="/guide" className="inline-link" style={{ color: "var(--blue)" }}>
          interpretation guide
        </Link>{" "}
        before acting on anything here.
      </p>
    </>
  );
}
