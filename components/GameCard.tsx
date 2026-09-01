import type { GameView } from "../lib/webData";
import {
  TeamRow,
  FlagChip,
  PickFlagChip,
  kickoffStr,
  spreadStr,
  signed,
  trim,
  teamShort,
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

  const meta = [
    g.status === "final" ? "Final" : kickoffStr(g.kickoff),
    g.broadcast,
    g.neutralSite ? "neutral" : null,
    g.indoor ? "indoor" : null,
    g.wind != null && g.wind >= 15 ? `wind ${trim(g.wind)}` : null,
  ].filter(Boolean);

  const paceFlags =
    g.picks[0]?.flags?.filter((f) =>
      ["wind", "slow_pace", "fast_pace"].includes(f)
    ) ?? [];

  // model projection but no sportsbook line anywhere yet
  const modelOnly =
    g.hasModel && g.marketSpread == null && g.marketTotal == null;

  const cls = ["card", g.picks.length && "pick", modelOnly && "model-only"]
    .filter(Boolean)
    .join(" ");

  return (
    <a href={`/game/${g.id}`} className={cls}>
      <div className="card-grid">
        <div className="gc-matchup">
          <TeamRow team={g.away} score={g.awayScore} won={awayWon} />
          <TeamRow team={g.home} score={g.homeScore} won={homeWon} />
          <div className="kick">
            {meta.join(" · ")}
            {modelOnly && <span className="kick-model"> · model only</span>}
          </div>
        </div>

        <div className="gc-spread mm">
          <span className="mm-label">Spread</span>
          {g.marketSpread != null ? (
            <>
              <span className="mm-line">
                <span className="mkt mono">
                  {teamShort(g.home)} {spreadStr(g.marketSpread)}
                </span>
              </span>
              <span className="mm-line">
                <span className="mdl mono">
                  model{" "}
                  {g.modelSpreadSp != null ? signed(-g.modelSpreadSp) : "–"}
                </span>
              </span>
              <EdgeTag
                edge={g.spreadEdge}
                threshold={SPREAD_EDGE_THRESHOLD}
                overLabel="home"
                underLabel="away"
              />
            </>
          ) : g.modelSpreadSp != null ? (
            <>
              <span className="mm-line">
                <span className="mkt mono mdl-proj">
                  <span className="proj-tag">proj</span>
                  {teamShort(g.home)} {spreadStr(-g.modelSpreadSp)}
                </span>
              </span>
              <span className="mm-line">
                <span className="na">no market line yet</span>
              </span>
            </>
          ) : (
            <span className="mm-line">
              <span className="na">—</span>
            </span>
          )}
        </div>

        <div className="gc-total mm">
          <span className="mm-label">Total</span>
          {g.marketTotal != null ? (
            <>
              <span className="mm-line">
                <span className="mkt mono">{trim(g.marketTotal)}</span>
              </span>
              <span className="mm-line">
                <span className="mdl mono">
                  model {g.modelTotal != null ? trim(g.modelTotal) : "–"}
                </span>
              </span>
              <EdgeTag
                edge={g.totalEdge}
                threshold={TOTAL_EDGE_THRESHOLD}
                overLabel="OVER"
                underLabel="UNDER"
              />
            </>
          ) : g.modelTotal != null ? (
            <>
              <span className="mm-line">
                <span className="mkt mono mdl-proj">
                  <span className="proj-tag">proj</span>
                  {trim(g.modelTotal)}
                </span>
              </span>
              <span className="mm-line">
                <span className="na">
                  {g.predictedPossessions != null
                    ? `${trim(g.predictedPossessions)} poss · `
                    : ""}
                  no market total yet
                </span>
              </span>
            </>
          ) : (
            <span className="mm-line">
              <span className="na">—</span>
            </span>
          )}
        </div>

        <div className="gc-rail">
          {g.picks.map((p, i) => (
            <span key={i} className="pick-pill">
              <span className="pick-pill-tag">PICK</span>
              <span className="pick-pill-side">{p.side}</span>
              {p.atsResult && (
                <span className={`res ${p.atsResult}`}>
                  {p.atsResult.toUpperCase()}
                </span>
              )}
            </span>
          ))}
          {(g.flags.length > 0 || paceFlags.length > 0) && (
            <span className="chips">
              {g.flags.map((f, i) => (
                <FlagChip key={`f${i}`} flag={f} showTeam />
              ))}
              {paceFlags.map((f, i) => (
                <PickFlagChip key={`p${i}`} label={f} />
              ))}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
