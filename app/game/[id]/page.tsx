import { notFound } from "next/navigation";
import { getGameDetail } from "../../../lib/webData";
import { median } from "../../../lib/consensus";
import { HOME_FIELD_ADVANTAGE } from "../../../lib/modelConfig";
import {
  TeamRow,
  FlagChip,
  FLAG_MEANING,
  HURT_FLAGS,
  HELP_FLAGS,
  flagDetail,
  kickoffStr,
  signed,
  trim,
  spreadStr,
} from "../../../components/ui";

export const dynamic = "force-dynamic";

const r1 = (n: number) => Math.round(n * 10) / 10;

interface LineRowLite {
  sportsbook: string;
  market: string;
  lineValue: number;
  price: number | null;
  snapshotType: string;
  capturedAt: Date;
}

/** bucket lines into pull-runs (90-min windows), newest first */
function lineTimeline(lines: LineRowLite[], market: string) {
  const rows = lines
    .filter((l) => l.market === market)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const buckets: LineRowLite[][] = [];
  for (const l of rows) {
    const last = buckets[buckets.length - 1];
    if (
      last &&
      l.capturedAt.getTime() - last[0].capturedAt.getTime() <= 90 * 60 * 1000
    ) {
      last.push(l);
    } else {
      buckets.push([l]);
    }
  }
  return buckets
    .map((b) => {
      const vals = b.map((x) => x.lineValue);
      return {
        at: b[0].capturedAt,
        type: b[0].snapshotType,
        median: median(vals)!,
        lo: Math.min(...vals),
        hi: Math.max(...vals),
        books: new Set(b.map((x) => x.sportsbook)).size,
      };
    })
    .reverse();
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getGameDetail(id);
  if (!data) notFound();

  const { game: g, pred, ratings, lines, weather } = data;

  const homeName = g.homeTeam.canonicalName;
  const awayName = g.awayTeam.canonicalName;
  const hr = ratings.find((x) => x.teamId === g.homeTeamId);
  const ar = ratings.find((x) => x.teamId === g.awayTeamId);
  const hfa = g.neutralSite ? 0 : HOME_FIELD_ADVANTAGE;

  const spreadTL = lineTimeline(lines as LineRowLite[], "spread");
  const totalTL = lineTimeline(lines as LineRowLite[], "total");
  const mktSpread = spreadTL[0]?.median ?? null; // home spread, neg = home favored
  const mktTotal = totalTL[0]?.median ?? null;
  const mktHomeMargin = mktSpread != null ? -mktSpread : null;

  const modelSp = pred?.predictedSpreadSpPlus ?? null;
  const modelSrs = pred?.predictedSpreadSrs ?? null;
  const modelTotal = pred?.predictedTotal ?? null;

  const spEdge =
    modelSp != null && mktHomeMargin != null ? r1(modelSp - mktHomeMargin) : null;
  const srsEdge =
    modelSrs != null && mktHomeMargin != null
      ? r1(modelSrs - mktHomeMargin)
      : null;
  const totEdge =
    modelTotal != null && mktTotal != null ? r1(modelTotal - mktTotal) : null;

  const homeWon =
    g.homeScore != null && g.awayScore != null && g.homeScore > g.awayScore;
  const awayWon =
    g.homeScore != null && g.awayScore != null && g.awayScore > g.homeScore;

  const marginRow = (
    label: string,
    home: number | null | undefined,
    away: number | null | undefined,
    model: number | null,
    edge: number | null
  ) => (
    <tr>
      <td>{label}</td>
      <td className="num">{home == null ? "–" : signed(r1(home))}</td>
      <td className="num">{away == null ? "–" : signed(r1(away))}</td>
      <td className="num">
        {model == null ? "–" : hfa === 0 ? "0 (neutral)" : `+${hfa}`}
      </td>
      <td className="num">{model == null ? "–" : signed(r1(model))}</td>
      <td className="num">
        {edge == null ? (
          "–"
        ) : (
          <span
            style={{
              color:
                Math.abs(edge) >= 2.5
                  ? edge > 0
                    ? "var(--green)"
                    : "var(--red)"
                  : "var(--text-dim)",
            }}
          >
            {signed(edge)} {Math.abs(edge) >= 2.5 ? (edge > 0 ? "home" : "away") : ""}
          </span>
        )}
      </td>
    </tr>
  );

  return (
    <>
      <div style={{ margin: "22px 0 4px" }}>
        <a href="/" style={{ color: "var(--text-faint)", fontSize: 12 }}>
          ← back to the board
        </a>
      </div>
      <h1 style={{ marginTop: 6 }}>
        {awayName} <span style={{ color: "var(--text-faint)" }}>@</span> {homeName}
      </h1>
      <p className="subhead">
        Week {g.week} · {g.season} ·{" "}
        {g.status === "final" ? "Final" : kickoffStr(g.kickoffTime.toISOString())}
        {g.venue ? ` · ${g.venue}` : ""}
        {g.neutralSite ? " · neutral site" : ""}
        {g.indoor ? " · indoor" : ""}
      </p>

      <div className="card" style={{ maxWidth: 460 }}>
        <div className="matchup">
          <TeamRow team={lite(g.awayTeam)} score={g.awayScore} won={awayWon} />
          <TeamRow team={lite(g.homeTeam)} score={g.homeScore} won={homeWon} />
        </div>
      </div>

      {/* ---------- spread ---------- */}
      <h2>Spread models</h2>
      {modelSp == null ? (
        <p className="subhead">
          No model prediction for this game — usually means one side isn&apos;t
          FBS or ratings weren&apos;t available that week.
        </p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">{shortName(homeName)} rating</th>
                  <th className="num">{shortName(awayName)} rating</th>
                  <th className="num">HFA</th>
                  <th className="num">Predicted margin</th>
                  <th className="num">Edge vs market</th>
                </tr>
              </thead>
              <tbody>
                {marginRow(
                  "SP+ (efficiency)",
                  hr?.spPlusOverall,
                  ar?.spPlusOverall,
                  modelSp,
                  spEdge
                )}
                {marginRow(
                  "SRS (scoring margin)",
                  hr?.srs,
                  ar?.srs,
                  modelSrs,
                  srsEdge
                )}
                <tr>
                  <td>Market consensus</td>
                  <td className="num" colSpan={3} style={{ color: "var(--text-faint)" }}>
                    {mktSpread == null
                      ? "no line yet"
                      : `${shortName(homeName)} ${spreadStr(r1(mktSpread))} · ${spreadTL[0].books} book${spreadTL[0].books > 1 ? "s" : ""}`}
                  </td>
                  <td className="num">
                    {mktHomeMargin == null ? "–" : signed(r1(mktHomeMargin))}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="subhead" style={{ marginTop: 10 }}>
            {modelSrs == null
              ? "SRS has no data yet (empty in week 1, noisy through ~week 3) — the spread signal is SP+ only right now."
              : Math.abs(modelSp - modelSrs) > 3
                ? `The two models disagree by ${trim(Math.abs(modelSp - modelSrs))} pts — treat this as lower confidence. See guide §1 for what a gap this size means.`
                : "The two models agree within ~3 pts — the rating signal is stable here."}{" "}
            Positive edge = model likes {homeName}; negative = {awayName}. Guide §2.
          </p>
        </>
      )}

      {/* ---------- total ---------- */}
      <h2>Totals model</h2>
      {modelTotal == null ? (
        <p className="subhead">No totals projection for this game.</p>
      ) : (
        <>
          <div className="tiles">
            <Tile
              k={`${shortName(homeName)} expected`}
              v={trim(r1(pred!.homeExpectedPpp != null ? homePts(pred!) : 0))}
              sub={`${pred!.homeExpectedPpp != null ? trim(r1(pred!.homeExpectedPpp)) : "–"} pts/poss`}
            />
            <Tile
              k={`${shortName(awayName)} expected`}
              v={trim(r1(pred!.awayExpectedPpp != null ? awayPts(pred!) : 0))}
              sub={`${pred!.awayExpectedPpp != null ? trim(r1(pred!.awayExpectedPpp)) : "–"} pts/poss`}
            />
            <Tile
              k="Possessions"
              v={
                pred!.predictedPossessions != null
                  ? trim(r1(pred!.predictedPossessions))
                  : "–"
              }
              sub={paceNote(pred!.predictedPossessions)}
            />
            <Tile
              k="Model total"
              v={trim(r1(modelTotal))}
              sub={
                mktTotal != null
                  ? `market ${trim(r1(mktTotal))}`
                  : "no market total"
              }
            />
            <Tile
              k="Edge"
              v={totEdge == null ? "–" : signed(totEdge)}
              vClass={
                totEdge == null || Math.abs(totEdge) < 3.5
                  ? ""
                  : totEdge > 0
                    ? "pos"
                    : "neg"
              }
              sub={
                totEdge == null
                  ? ""
                  : Math.abs(totEdge) < 3.5
                    ? "under the 3.5-pt bar — noise"
                    : totEdge > 0
                      ? "model leans OVER"
                      : "model leans UNDER"
              }
            />
          </div>
          <p className="subhead">
            Only SP+ feeds this (SRS is one number). Totals are noisier than
            spreads — the model&apos;s biggest UNDER edges cluster on blowouts and
            are mostly artifacts. Trust it most on games with a spread inside ~14.
            Guide §3.
          </p>
        </>
      )}

      {/* ---------- flags ---------- */}
      <h2>Situational flags</h2>
      {g.gameFlags.length === 0 ? (
        <p className="subhead">No situational flags on this game.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {g.gameFlags.map((f) => {
            const dir = HURT_FLAGS.has(f.flagType)
              ? "hurts"
              : HELP_FLAGS.has(f.flagType)
                ? "helps"
                : "";
            const det = flagDetail(f.flagType, f.detail);
            return (
              <div
                key={f.id}
                className="card"
                style={{ marginBottom: 0, maxWidth: 760 }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <FlagChip flag={{ ...f, team: f.team.canonicalName, detail: f.detail }} />
                  <strong>{f.team.canonicalName}</strong>
                  {det && (
                    <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
                      {det}
                    </span>
                  )}
                  {dir && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 11,
                        color:
                          dir === "hurts" ? "var(--red)" : "var(--green)",
                      }}
                    >
                      {dir} {f.team.canonicalName}
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--text-dim)", fontSize: 12.5 }}>
                  {FLAG_MEANING[f.flagType] ?? ""}
                </div>
              </div>
            );
          })}
          <p className="subhead" style={{ marginTop: 2 }}>
            Flags corroborate, they never drive a pick. A flag against a team the
            model already dislikes is a green light; against a team the model
            likes, it cancels out. Guide §5.
          </p>
        </div>
      )}

      {/* ---------- line movement ---------- */}
      <h2>Line movement</h2>
      {spreadTL.length === 0 && totalTL.length === 0 ? (
        <p className="subhead">No sportsbook lines captured for this game yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Captured</th>
                <th>Snapshot</th>
                <th className="num">Spread (home)</th>
                <th className="num">Total</th>
                <th className="num">Books</th>
              </tr>
            </thead>
            <tbody>
              {mergeTimelines(spreadTL, totalTL).map((row, i) => (
                <tr key={i}>
                  <td>{stamp(row.at)}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.type}</td>
                  <td className="num">
                    {row.spread == null ? "–" : spreadStr(r1(row.spread))}
                    {row.spreadRange && (
                      <span
                        style={{ color: "var(--text-faint)", marginLeft: 6 }}
                      >
                        {row.spreadRange}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {row.total == null ? "–" : trim(r1(row.total))}
                    {row.totalRange && (
                      <span
                        style={{ color: "var(--text-faint)", marginLeft: 6 }}
                      >
                        {row.totalRange}
                      </span>
                    )}
                  </td>
                  <td className="num">{row.books}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- weather ---------- */}
      {!g.indoor && (
        <>
          <h2>Weather</h2>
          {weather.length === 0 ? (
            <p className="subhead">
              No forecast yet — pulled once the game is inside the ~16-day
              forecast horizon.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Pulled</th>
                    <th className="num">Temp</th>
                    <th className="num">Wind</th>
                    <th className="num">Precip</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weather].reverse().map((w) => (
                    <tr key={w.id}>
                      <td>{stamp(w.pulledAt)}</td>
                      <td className="num">
                        {w.tempF == null ? "–" : `${Math.round(w.tempF)}°F`}
                      </td>
                      <td
                        className="num"
                        style={{
                          color:
                            w.windMph != null && w.windMph >= 15
                              ? "var(--blue)"
                              : undefined,
                        }}
                      >
                        {w.windMph == null ? "–" : `${trim(r1(w.windMph))} mph`}
                      </td>
                      <td className="num">
                        {w.precipProbability == null
                          ? "–"
                          : `${Math.round(w.precipProbability)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="subhead" style={{ marginTop: 8 }}>
            Sustained wind ≥ 15 mph is the one weather factor that reliably moves
            a total (UNDER). Everything else is minor. Guide §4.
          </p>
        </>
      )}

      {/* ---------- injuries ---------- */}
      <h2>Injuries</h2>
      {g.injuries.length === 0 ? (
        <p className="subhead">
          No impact-player injuries listed. ESPN&apos;s CFB feed is thin — an
          empty report means &quot;unknown,&quot; not &quot;clean.&quot; Guide §4.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Player</th>
                <th>Pos</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {g.injuries.map((inj) => (
                <tr key={inj.id}>
                  <td>{inj.team.canonicalName}</td>
                  <td>{inj.playerName}</td>
                  <td>{inj.position ?? "–"}</td>
                  <td style={{ textTransform: "capitalize" }}>{inj.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- picks ---------- */}
      <h2>Picks</h2>
      {g.picks.length === 0 ? (
        <p className="subhead">
          No pick logged. Most model disagreements never become picks — see guide
          §6 for the bar.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {g.picks.map((p) => {
            const flags = Array.isArray(p.flagsPresent)
              ? (p.flagsPresent as string[])
              : [];
            const backHome = p.edge > 0;
            const side =
              p.market === "spread"
                ? backHome
                  ? `${homeName} ${spreadStr(r1(-p.marketLine))}`
                  : `${awayName} +${trim(r1(p.marketLine))}`
                : `${backHome ? "Over" : "Under"} ${trim(r1(p.marketLine))}`;
            const clv =
              p.closingLine == null
                ? null
                : r1(
                    backHome
                      ? p.closingLine - p.marketLine
                      : p.marketLine - p.closingLine
                  );
            return (
              <div
                key={p.id}
                className="card pick"
                style={{ marginBottom: 0, maxWidth: 760 }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <span className="pick-badge">PICK</span>
                  <strong style={{ fontSize: 15 }}>{side}</strong>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
                    {p.market} · {p.method} · logged at {signed(r1(p.edge))} edge
                  </span>
                  {p.atsResult && (
                    <span
                      className={`res ${p.atsResult}`}
                      style={{ marginLeft: "auto" }}
                    >
                      {p.atsResult.toUpperCase()}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    gap: 18,
                    flexWrap: "wrap",
                    fontFamily: "var(--mono)",
                    fontSize: 12.5,
                    color: "var(--text-dim)",
                  }}
                >
                  <span>model {trim(r1(p.modelLine))}</span>
                  <span>logged line {trim(r1(p.marketLine))}</span>
                  <span>
                    close{" "}
                    {p.closingLine == null ? "–" : trim(r1(p.closingLine))}
                  </span>
                  <span
                    style={{
                      color:
                        clv == null
                          ? undefined
                          : clv > 0
                            ? "var(--green)"
                            : clv < 0
                              ? "var(--red)"
                              : undefined,
                    }}
                  >
                    CLV {clv == null ? "–" : signed(clv)}
                  </span>
                </div>
                {flags.length > 0 && (
                  <div className="chips" style={{ marginTop: 8, justifyContent: "flex-start" }}>
                    {flags.map((fl, i) => (
                      <span key={i} className="chip">
                        {fl}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="foot">
        Decision support, not a guarantee. Read the{" "}
        <a href="/guide" style={{ color: "var(--blue)" }}>
          interpretation guide
        </a>
        .
      </p>
    </>
  );
}

// ---------- small helpers / sub-components ----------

function lite(t: {
  id: string;
  canonicalName: string;
  logoLight: string | null;
  color: string | null;
  classification: string;
  conference: string | null;
}) {
  return {
    id: t.id,
    name: t.canonicalName,
    logo: t.logoLight,
    color: t.color,
    classification: t.classification,
    conference: t.conference,
  };
}

function shortName(name: string): string {
  return name.length > 16 ? name.split(" ")[0] : name;
}

function Tile({
  k,
  v,
  sub,
  vClass = "",
}: {
  k: string;
  v: string;
  sub?: string;
  vClass?: string;
}) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className={`v ${vClass}`}>{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

function homePts(p: {
  homeExpectedPpp: number | null;
  predictedPossessions: number | null;
}) {
  if (p.homeExpectedPpp == null || p.predictedPossessions == null) return 0;
  return p.homeExpectedPpp * (p.predictedPossessions / 2);
}
function awayPts(p: {
  awayExpectedPpp: number | null;
  predictedPossessions: number | null;
}) {
  if (p.awayExpectedPpp == null || p.predictedPossessions == null) return 0;
  return p.awayExpectedPpp * (p.predictedPossessions / 2);
}

function paceNote(poss: number | null): string {
  if (poss == null) return "";
  if (poss <= 21) return "slow, grind-it-out";
  if (poss >= 26) return "fast";
  return "average pace";
}

function stamp(d: Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

interface TLRow {
  at: Date;
  type: string;
  median: number;
  lo: number;
  hi: number;
  books: number;
}

function mergeTimelines(spread: TLRow[], total: TLRow[]) {
  const key = (d: Date) => Math.round(new Date(d).getTime() / (90 * 60 * 1000));
  const map = new Map<
    number,
    {
      at: Date;
      type: string;
      spread: number | null;
      total: number | null;
      spreadRange: string;
      totalRange: string;
      books: number;
    }
  >();
  for (const s of spread) {
    map.set(key(s.at), {
      at: s.at,
      type: s.type,
      spread: s.median,
      total: null,
      spreadRange: s.lo !== s.hi ? `${trim(s.lo)}…${trim(s.hi)}` : "",
      totalRange: "",
      books: s.books,
    });
  }
  for (const t of total) {
    const k = key(t.at);
    const ex = map.get(k);
    if (ex) {
      ex.total = t.median;
      ex.totalRange = t.lo !== t.hi ? `${trim(t.lo)}…${trim(t.hi)}` : "";
      ex.books = Math.max(ex.books, t.books);
    } else {
      map.set(k, {
        at: t.at,
        type: t.type,
        spread: null,
        total: t.median,
        spreadRange: "",
        totalRange: t.lo !== t.hi ? `${trim(t.lo)}…${trim(t.hi)}` : "",
        books: t.books,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
}
