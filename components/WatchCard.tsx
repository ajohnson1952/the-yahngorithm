import type { WatchGame } from "../lib/watchGuide";
import { TeamRow, FlagChip, kickoffStr, spreadStr, trim, teamShort } from "./ui";

export function WatchCard({ g, rank }: { g: WatchGame; rank?: number }) {
  const live = g.live && g.live.state !== "pre" ? g.live : null;
  const isLive = live?.state === "in";
  const isFinal = live?.state === "post" || g.status === "final";

  const homeWon =
    isFinal && g.homeScore != null && g.awayScore != null && g.homeScore > g.awayScore;
  const awayWon =
    isFinal && g.homeScore != null && g.awayScore != null && g.awayScore > g.homeScore;

  return (
    <a
      href={`/game/${g.id}`}
      className={`watch-card${isLive ? " is-live" : ""}${
        live?.state === "post" ? " is-final" : ""
      }`}
    >
      <div className="watch-card-top">
        {rank != null && <span className="watch-rank">{rank}</span>}
        <span className="watch-card-top-right">
          {isLive && <span className="watch-live">{live!.detail || "live"}</span>}
          <span className="watch-score" title="watchability score, 0-100">
            {g.score}
          </span>
        </span>
      </div>
      <div className="watch-teams">
        <TeamRow team={g.away} score={g.awayScore} won={awayWon} />
        <TeamRow team={g.home} score={g.homeScore} won={homeWon} />
      </div>
      {(g.marketSpread != null || g.marketTotal != null) && (
        <div className="watch-lines">
          {g.marketSpread != null && (
            <span className="watch-line mono">
              {teamShort(g.home)} {spreadStr(g.marketSpread)}
            </span>
          )}
          {g.marketTotal != null && (
            <span className="watch-line mono">
              O/U {trim(g.marketTotal)}
              {g.predictedPossessions != null ? ` · ${trim(g.predictedPossessions)} poss` : ""}
            </span>
          )}
        </div>
      )}
      <div className="watch-card-meta">
        {kickoffStr(g.kickoff)}
        {g.broadcast ? ` · ${g.broadcast}` : ""}
        {live?.state === "post" ? " · Final" : ""}
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
      {g.flags.length > 0 && (
        <div className="chips watch-flags">
          {g.flags.map((f, i) => (
            <FlagChip key={i} flag={f} showTeam />
          ))}
        </div>
      )}
    </a>
  );
}
