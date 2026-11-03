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

  // group by week (newest first), each week in kickoff order
  const byWeek = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byWeek.get(r.week) ?? [];
    list.push(r);
    byWeek.set(r.week, list);
  }
  const weeks = [...byWeek.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([week, list]) => {
      const sorted = [...list].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
      const win = list.filter((r) => r.atsResult === "win").length;
      const loss = list.filter((r) => r.atsResult === "loss").length;
      const push = list.filter((r) => r.atsResult === "push").length;
      const clvs = list.map((r) => r.clv).filter((c): c is number => c != null);
      return {
        week,
        rows: sorted,
        win,
        loss,
        push,
        decided: win + loss,
        units: unitsAt110(win, loss),
        pending: list.filter((r) => !r.atsResult).length,
        clvAvg: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
      };
    });

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
        <div className="pl-weeks">
          {weeks.map((w, wi) => (
            // the two most recent weeks start open; older ones fold away
            <details key={w.week} className="pl-week" open={wi < 2}>
              <summary>
                <span className="pl-week-name">Week {w.week}</span>
                <span className="pl-week-stats">
                  {w.decided + w.push > 0 ? (
                    <>
                      <span>
                        {w.win}–{w.loss}
                        {w.push ? `–${w.push}` : ""}
                      </span>
                      {w.decided > 0 && (
                        <span className={w.units > 0 ? "pos" : w.units < 0 ? "neg" : ""}>
                          {w.units > 0 ? "+" : w.units < 0 ? "−" : ""}
                          {Math.abs(w.units).toFixed(2)}u
                        </span>
                      )}
                    </>
                  ) : null}
                  {w.clvAvg != null && (
                    <span className={w.clvAvg > 0 ? "pos" : w.clvAvg < 0 ? "neg" : ""}>
                      CLV {signed(w.clvAvg)}
                    </span>
                  )}
                  {w.pending > 0 && <span className="pl-dim">{w.pending} pending</span>}
                  <span className="pl-dim">
                    {w.rows.length} pick{w.rows.length === 1 ? "" : "s"}
                  </span>
                </span>
              </summary>

              <div className="pl-head" aria-hidden="true">
                <span>Game</span>
                <span>Pick</span>
                <span className="num">Edge</span>
                <span className="num">Close</span>
                <span className="num">CLV</span>
                <span>Result</span>
              </div>
              {w.rows.map((r) => (
                <Link key={r.id} href={`/game/${r.gameId}`} prefetch={false} className="pl-row">
                  <span className="pl-game">
                    <span className="pl-teams">
                      {r.awayRank != null && <span className="ap-rank">{r.awayRank}</span>}
                      {r.away} @{" "}
                      {r.homeRank != null && <span className="ap-rank">{r.homeRank}</span>}
                      {r.home}
                    </span>
                    <span className="pl-kick">{kickoffStr(r.kickoff)}</span>
                  </span>
                  <span className="pl-pick">
                    <span className="mono">{r.side}</span>
                    <span className="pl-market">
                      {r.market === "spread" ? "spread" : "total"} · {r.method}
                    </span>
                  </span>
                  <span className="pl-stats">
                  <span className="pl-stat num">
                    <span className="pl-label">edge </span>
                    {signed(r.edge)}
                  </span>
                  <span className="pl-stat num">
                    <span className="pl-label">close </span>
                    {r.closingLine == null ? "–" : trim(r.closingLine)}
                  </span>
                  <span
                    className={`pl-stat num ${r.clv == null ? "pl-dim" : r.clv > 0 ? "pos" : r.clv < 0 ? "neg" : ""}`}
                  >
                    <span className="pl-label">CLV </span>
                    {r.clv == null ? "–" : signed(r.clv)}
                  </span>
                  </span>
                  <span className="pl-result">
                    {r.atsResult ? (
                      <span className={`res ${r.atsResult}`}>
                        {r.atsResult.toUpperCase()}
                        {r.actualResult != null && (
                          <span className="pl-margin">
                            {r.market === "spread"
                              ? `by ${trim(Math.abs(r.actualResult))}`
                              : `${trim(r.actualResult)} pts`}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="pl-dim">pending</span>
                    )}
                  </span>
                </Link>
              ))}
            </details>
          ))}
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
