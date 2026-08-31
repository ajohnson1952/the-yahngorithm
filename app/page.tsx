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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const season = currentSeason();
  const sp = await searchParams;
  const thisWeek = await currentWeek(season);
  const week = sp.week ? Number(sp.week) : thisWeek;

  const [board, weeks] = await Promise.all([
    getWeekBoard(season, week),
    weeksWithGames(season),
  ]);

  const prev = weeks.filter((w) => w < week).pop() ?? null;
  const next = weeks.find((w) => w > week) ?? null;

  const groups = new Map<number, typeof board>();
  for (const g of board) {
    const arr = groups.get(g.sortRank) ?? [];
    arr.push(g);
    groups.set(g.sortRank, arr);
  }

  const pickCount = groups.get(0)?.length ?? 0;

  return (
    <>
      <div className="weeknav">
        {prev != null ? (
          <a href={`/?week=${prev}`}>← Week {prev}</a>
        ) : (
          <span className="disabled">&nbsp;</span>
        )}
        <span className="weeknav-cur">
          Week {week}
          <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>
            {" "}
            · {season}
          </span>
          {week !== thisWeek && (
            <a href="/" className="weeknav-jump">
              this week ({thisWeek})
            </a>
          )}
        </span>
        {next != null ? (
          <a href={`/?week=${next}`}>Week {next} →</a>
        ) : (
          <span className="disabled">&nbsp;</span>
        )}
      </div>

      <p className="subhead">
        {board.length} games ·{" "}
        {pickCount === 0
          ? "no picks this week — the model and the market agree where it counts"
          : `${pickCount} pick${pickCount > 1 ? "s" : ""} logged`}
        . Numbers are the consensus across sportsbooks; &quot;model&quot; is our
        projection.
      </p>

      {[0, 1, 2, 3, 4, 6].map((rank) => {
        const gs = groups.get(rank);
        if (!gs || gs.length === 0) return null;
        return (
          <section key={rank}>
            <div className="section-label">{RANK_LABEL[rank]}</div>
            {gs.map((g) => (
              <GameCard key={g.id} g={g} />
            ))}
          </section>
        );
      })}

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
