import type { GameView } from "../lib/webData";
import {
  TeamRow,
  FlagChip,
  PickFlagChip,
  kickoffStr,
  spreadStr,
  signed,
  trim,
  shortTeam,
} from "./ui";
import { SPREAD_EDGE_THRESHOLD, TOTAL_EDGE_THRESHOLD } from "../lib/modelConfig";

function EdgeTag({
  edge,
  threshold,
  overLabel,
  underLabel,
}: {
  edge: number | null;
  threshold: number;
  overLabel: string;
  underLabel: string;
}) {
  if (edge == null) return null;
  const big = Math.abs(edge) >= threshold;
  if (!big) return <span className="edge small">{signed(edge)}</span>;
  return (
    <span className={`edge ${edge > 0 ? "big-over" : "big-under"}`}>
      {signed(edge)} {edge > 0 ? overLabel : underLabel}
    </span>
  );
}

export function GameCard({ g }: { g: GameView }) {
  const homeWon =
    g.homeScore != null && g.awayScore != null && g.homeScore > g.awayScore;
  const awayWon =
    g.homeScore != null && g.awayScore != null && g.awayScore > g.homeScore;

  return (
    <a href={`/game/${g.id}`} className={`card${g.picks.length ? " pick" : ""}`}>
      <div className="card-grid">
        {/* matchup */}
        <div className="matchup">
          <TeamRow team={g.away} score={g.awayScore} won={awayWon} />
          <TeamRow team={g.home} score={g.homeScore} won={homeWon} />
          <div className="kick">
            {g.status === "final" ? "Final" : kickoffStr(g.kickoff)}
            {g.neutralSite ? " · neutral" : ""}
            {g.indoor ? " · indoor" : ""}
            {g.wind != null && g.wind >= 12 ? ` · wind ${trim(g.wind)}` : ""}
          </div>
        </div>

        {/* spread */}
        <div className="mm">
          <span className="mm-label">Spread</span>
          {g.marketSpread != null ? (
            <>
              <span className="mm-line">
                <span className="mkt mono">
                  {shortTeam(g.home.name)} {spreadStr(g.marketSpread)}
                </span>
              </span>
              <span className="mm-line">
                <span className="mdl mono">
                  model {g.modelSpreadSp != null ? signed(-g.modelSpreadSp) : "–"}
                  {g.modelSpreadSrs != null
                    ? ` · srs ${signed(-g.modelSpreadSrs)}`
                    : ""}
                </span>
              </span>
              <EdgeTag
                edge={g.spreadEdge}
                threshold={SPREAD_EDGE_THRESHOLD}
                overLabel="home"
                underLabel="away"
              />
            </>
          ) : (
            <span className="mm-line">
              <span className="na">{g.hasModel ? "no line yet" : "—"}</span>
            </span>
          )}
        </div>

        {/* total */}
        <div className="mm">
          <span className="mm-label">Total</span>
          {g.marketTotal != null ? (
            <>
              <span className="mm-line">
                <span className="mkt mono">{trim(g.marketTotal)}</span>
              </span>
              <span className="mm-line">
                <span className="mdl mono">
                  model {g.modelTotal != null ? trim(g.modelTotal) : "–"}
                  {g.predictedPossessions != null
                    ? ` · ${trim(g.predictedPossessions)} poss`
                    : ""}
                </span>
              </span>
              <EdgeTag
                edge={g.totalEdge}
                threshold={TOTAL_EDGE_THRESHOLD}
                overLabel="OVER"
                underLabel="UNDER"
              />
            </>
          ) : (
            <span className="mm-line">
              <span className="na">{g.hasModel ? "no total yet" : "—"}</span>
            </span>
          )}
        </div>

        {/* rail */}
        <div className="rail">
          {g.picks.map((p, i) => (
            <div key={i} style={{ textAlign: "right" }}>
              <span className="pick-badge">PICK</span>
              <div className="pick-side">
                {p.side}
                {p.atsResult && (
                  <span className={`res ${p.atsResult}`}>
                    {p.atsResult.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          ))}
          {g.flags.length > 0 && (
            <div className="chips">
              {g.flags.slice(0, 4).map((f, i) => (
                <FlagChip key={i} flag={f} showTeam />
              ))}
            </div>
          )}
          {g.picks[0]?.flags?.length ? (
            <div className="chips">
              {g.picks[0].flags
                .filter((f) => ["wind", "slow_pace", "fast_pace"].includes(f))
                .map((f, i) => (
                  <PickFlagChip key={i} label={f} />
                ))}
            </div>
          ) : null}
        </div>
      </div>
    </a>
  );
}
