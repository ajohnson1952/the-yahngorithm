import Link from "next/link";
import { currentSeason } from "../../lib/currentWeek";
import { getPickLog } from "../../lib/webData";
import { signed, trim, kickoffStr, unitsAt110 } from "../../components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pick log · the yahngorithm",
};

export default async function PicksPage() {
  const season = currentSeason();
  const { rows, record, clvAvg, clvBeat, clvCount } = await getPickLog(season);

  const graded = record.win + record.loss + record.push;
  const decided = record.win + record.loss;
  const winPct = decided ? Math.round((record.win / decided) * 100) : null;
  const units = unitsAt110(record.win, record.loss);

  return (
    <>
      <h1>
        Pick log
        <span
          style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: 15 }}
        >
          {" "}
          · {season}
        </span>
      </h1>
      <p className="subhead">
        Every pick logged the first moment it qualified, frozen at that line.
        Watch the CLV, not the record — see{" "}
        <Link href="/guide" style={{ color: "var(--blue)" }}>
          guide §7
        </Link>
        .
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="k">ATS record</div>
          <div className="v">
            {record.win}–{record.loss}
            {record.push ? `–${record.push}` : ""}
          </div>
          <div className="sub">
            {graded === 0
              ? "nothing graded yet"
              : winPct != null
                ? `${winPct}% of decided`
                : ""}
          </div>
        </div>
        <div className="tile">
          <div className="k">Units</div>
          <div className={`v ${decided === 0 ? "" : units > 0 ? "pos" : units < 0 ? "neg" : ""}`}>
            {decided === 0 ? "–" : `${units > 0 ? "+" : units < 0 ? "−" : ""}${Math.abs(units).toFixed(2)}u`}
          </div>
          <div className="sub">1 unit per pick at −110</div>
        </div>
        <div className="tile">
          <div className="k">Avg CLV</div>
          <div
            className={`v ${clvAvg == null ? "" : clvAvg > 0 ? "pos" : clvAvg < 0 ? "neg" : ""}`}
          >
            {clvAvg == null ? "–" : signed(clvAvg)}
          </div>
          <div className="sub">
            {clvCount === 0
              ? "no closing lines yet"
              : `across ${clvCount} pick${clvCount > 1 ? "s" : ""}`}
          </div>
        </div>
        <div className="tile">
          <div className="k">Beat the close</div>
          <div className="v">
            {clvCount === 0 ? "–" : `${clvBeat}/${clvCount}`}
          </div>
          <div className="sub">picks that beat the closing number</div>
        </div>
        <div className="tile">
          <div className="k">Logged</div>
          <div className="v">{rows.length}</div>
          <div className="sub">total picks this season</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No picks logged yet this season.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Wk</th>
                <th>Game</th>
                <th>Market</th>
                <th>Pick</th>
                <th className="num">Edge</th>
                <th className="num">Close</th>
                <th className="num">CLV</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.week}</td>
                  <td>
                    <Link href={`/game/${r.gameId}`} prefetch={false}>
                      {r.awayRank != null && (
                        <span className="ap-rank">{r.awayRank}</span>
                      )}
                      {r.away} @{" "}
                      {r.homeRank != null && (
                        <span className="ap-rank">{r.homeRank}</span>
                      )}
                      {r.home}
                    </Link>
                    <div
                      style={{ color: "var(--text-faint)", fontSize: 11 }}
                    >
                      {kickoffStr(r.kickoff)}
                    </div>
                  </td>
                  <td style={{ textTransform: "capitalize" }}>
                    {r.market}
                    <span
                      style={{
                        color: "var(--text-faint)",
                        marginLeft: 6,
                        fontSize: 11,
                      }}
                    >
                      {r.method}
                    </span>
                  </td>
                  <td className="mono">{r.side}</td>
                  <td className="num">{signed(r.edge)}</td>
                  <td className="num">
                    {r.closingLine == null ? "–" : trim(r.closingLine)}
                  </td>
                  <td
                    className="num"
                    style={{
                      color:
                        r.clv == null
                          ? "var(--text-faint)"
                          : r.clv > 0
                            ? "var(--green)"
                            : r.clv < 0
                              ? "var(--red)"
                              : "var(--text-dim)",
                    }}
                  >
                    {r.clv == null ? "–" : signed(r.clv)}
                  </td>
                  <td>
                    {r.atsResult ? (
                      <span className={`res ${r.atsResult}`}>
                        {r.atsResult.toUpperCase()}
                        {r.actualResult != null && (
                          <span
                            style={{
                              color: "var(--text-faint)",
                              marginLeft: 6,
                              fontWeight: 400,
                            }}
                          >
                            {r.market === "spread"
                              ? `by ${trim(Math.abs(r.actualResult))}`
                              : `${trim(r.actualResult)} pts`}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-faint)" }}>pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="foot">
        CLV = points our number beat the closing line, from our side. Positive
        average CLV is the signal that the process is finding value, independent
        of that season&apos;s win/loss variance.
      </p>
    </>
  );
}
