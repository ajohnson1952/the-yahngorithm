import type { WatchGame } from "../lib/watchGuide";
import { TeamRow, kickoffStr } from "./ui";

export function WatchCard({ g, rank }: { g: WatchGame; rank?: number }) {
  const homeWon =
    g.status === "final" && g.homeScore != null && g.awayScore != null && g.homeScore > g.awayScore;
  const awayWon =
    g.status === "final" && g.homeScore != null && g.awayScore != null && g.awayScore > g.homeScore;

  return (
    <a href={`/game/${g.id}`} className="watch-card">
      <div className="watch-card-top">
        {rank != null && <span className="watch-rank">{rank}</span>}
        <span className="watch-score" title="watchability score, 0-100">
          {g.score}
        </span>
      </div>
      <div className="watch-teams">
        <TeamRow team={g.away} score={g.awayScore} won={awayWon} />
        <TeamRow team={g.home} score={g.homeScore} won={homeWon} />
      </div>
      <div className="watch-card-meta">
        {kickoffStr(g.kickoff)}
        {g.broadcast ? ` · ${g.broadcast}` : ""}
        {g.status === "final" ? " · Final" : ""}
      </div>
      {g.reasons.length > 0 && (
        <div className="watch-reasons">
          {g.reasons.map((r, i) => (
            <span key={i} className="watch-reason">
              {r}
            </span>
          ))}
        </div>
      )}
    </a>
  );
}
