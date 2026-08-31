import { currentSeason } from "../../lib/currentWeek";
import { getGradeBoard } from "../../lib/webData";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model grades · the yahngorithm" };

const BREAKEVEN = 0.524;

function Rate({ rate }: { rate: number | null }) {
  if (rate == null) return <span style={{ color: "var(--text-faint)" }}>–</span>;
  const good = rate >= BREAKEVEN;
  return (
    <span
      style={{
        color: good ? "var(--green)" : rate < 0.5 ? "var(--red)" : "var(--text-dim)",
        fontWeight: good ? 700 : 400,
      }}
    >
      {(100 * rate).toFixed(1)}%
    </span>
  );
}

export default async function GradesPage() {
  const season = currentSeason();
  const { rows, gamesGraded } = await getGradeBoard(season);
  const models = rows.filter((r) => r.kind === "model");
  const flags = rows.filter((r) => r.kind === "flag");

  return (
    <>
      <h1>
        Model grades
        <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: 15 }}>
          {" "}
          · {season}
        </span>
      </h1>
      <p className="subhead">
        Every spread model and every flag, graded against the closing line on each
        final game — the hindsight-free record. Break-even is 52.4%. Backtests say
        expect ~50%; see the{" "}
        <a href="/guide" style={{ color: "var(--blue)" }}>
          guide
        </a>
        . {gamesGraded} game{gamesGraded === 1 ? "" : "s"} graded so far.
      </p>

      <p className="subhead" style={{ fontSize: 12 }}>
        <strong>ATS</strong> = record betting the side the model favored over the
        market (a win = that side covered the close). <strong>Win %</strong> is of
        decided bets; 52.4% is break-even at −110. <strong>Edge ≥ 2</strong> = only
        games the model was ≥ 2 pts off the close. <strong>MAE</strong> = average
        miss between the predicted and actual margin, in points (the closing line
        itself is ~12.0 — lower is better).
      </p>

      {rows.length === 0 ? (
        <p className="empty">
          Nothing graded yet — this fills in after the first Sunday of results.
        </p>
      ) : (
        <>
          <h2>Spread models vs. the close</h2>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">ATS</th>
                  <th className="num">Win %</th>
                  <th className="num">Edge ≥ 2</th>
                  <th className="num">MAE</th>
                </tr>
              </thead>
              <tbody>
                {models.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="num mono">
                      {r.win}–{r.loss}
                      {r.push ? `–${r.push}` : ""}
                    </td>
                    <td className="num">
                      <Rate rate={r.rate} />
                    </td>
                    <td className="num mono">
                      {r.bigWin + r.bigLoss === 0
                        ? "–"
                        : `${r.bigWin}–${r.bigLoss}`}
                    </td>
                    <td className="num mono">{r.mae ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Flags — betting the implied side</h2>
          {flags.length === 0 ? (
            <p className="subhead">No flags have fired on a graded game yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Flag</th>
                    <th className="num">ATS</th>
                    <th className="num">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num mono">
                        {r.win}–{r.loss}
                        {r.push ? `–${r.push}` : ""}
                      </td>
                      <td className="num">
                        <Rate rate={r.rate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="foot">
        A model &quot;wins&quot; a game when the side it favored over the market
        went on to cover the closing number. Small samples early — one week is
        noise. Watch the trend across the season, not any single number.
      </p>
    </>
  );
}
