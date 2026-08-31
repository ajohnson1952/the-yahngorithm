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
  stampCT,
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

interface TLRow {
  at: Date;
  type: string;
  median: number;
  lo: number;
  hi: number;
  books: number;
}

/** bucket lines into pull-runs (90-min windows), newest first */
function lineTimeline(lines: LineRowLite[], market: string): TLRow[] {
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

function mergeTimelines(spread: TLRow[], total: TLRow[]) {
  const key = (d: Date) => Math.round(new Date(d).getTime() / (90 * 60 * 1000));
  type Row = {
    at: Date;
    type: string;
    spread: number | null;
    total: number | null;
    spreadRange: string;
    totalRange: string;
    books: number;
  };
  const range = (lo: number, hi: number) =>
    lo !== hi ? `${trim(lo)}–${trim(hi)}` : "";
  const map = new Map<number, Row>();
  for (const s of spread) {
    map.set(key(s.at), {
      at: s.at,
      type: s.type,
      spread: s.median,
      total: null,
      spreadRange: range(s.lo, s.hi),
      totalRange: "",
      books: s.books,
    });
  }
  for (const t of total) {
    const k = key(t.at);
    const ex = map.get(k);
    if (ex) {
      ex.total = t.median;
      ex.totalRange = range(t.lo, t.hi);
      ex.books = Math.max(ex.books, t.books);
    } else {
      map.set(k, {
        at: t.at,
        type: t.type,
        spread: null,
        total: t.median,
        spreadRange: "",
        totalRange: range(t.lo, t.hi),
        books: t.books,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getGameDetail(id);
  if (!data) notFound();

  const { game: g, pred, ratings, lines, weather, homeApRank, awayApRank } = data;

  const home = g.homeTeam;
  const away = g.awayTeam;
  const homeShort = home.abbreviation ?? shortName(home.canonicalName);
  const awayShort = away.abbreviation ?? shortName(away.canonicalName);
  const hr = ratings.find((x) => x.teamId === g.homeTeamId);
  const ar = ratings.find((x) => x.teamId === g.awayTeamId);
  const hfa = g.neutralSite ? 0 : HOME_FIELD_ADVANTAGE;

  const spreadTL = lineTimeline(lines as LineRowLite[], "spread");
  const totalTL = lineTimeline(lines as LineRowLite[], "total");
  const mktSpread = spreadTL[0]?.median ?? null; // home spread, neg = home favored
  const mktTotal = totalTL[0]?.median ?? null;
  const mktHomeMargin = mktSpread != null ? -mktSpread : null;
  const books = spreadTL[0]?.books ?? totalTL[0]?.books ?? 0;

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

  const meta = [
    `Week ${g.week} · ${g.season}`,
    g.status === "final" ? "Final" : kickoffStr(g.kickoffTime.toISOString()),
    g.broadcast,
    g.venue,
    g.neutralSite ? "neutral site" : null,
    g.indoor ? "indoor" : null,
  ].filter(Boolean);

  // predicted margin -> "TEAM ±n" in spread form
  const spreadForm = (homeMargin: number) =>
    homeMargin >= 0
      ? `${homeShort} ${spreadStr(-r1(homeMargin))}`
      : `${awayShort} ${spreadStr(r1(homeMargin))}`;

  return (
    <>
      <div style={{ margin: "20px 0 0" }}>
        <a className="inline-link" href="/" style={{ color: "var(--text-faint)", fontSize: 12 }}>
          ← back to the board
        </a>
      </div>
      <h1 style={{ marginTop: 8 }}>
        {away.canonicalName}{" "}
        <span style={{ color: "var(--text-faint)" }}>@</span>{" "}
        {home.canonicalName}
      </h1>
      <p className="subhead">{meta.join(" · ")}</p>

      <div className="card" style={{ maxWidth: 440 }}>
        <div className="matchup">
          <TeamRow team={lite(away, awayApRank)} score={g.awayScore} won={awayWon} />
          <TeamRow team={lite(home, homeApRank)} score={g.homeScore} won={homeWon} />
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
          <div className="mrows">
            <ModelRow
              name="SP+"
              tag="efficiency"
              calc={`${awayShort} ${signed(r1(ar?.spPlusOverall ?? 0))} vs ${homeShort} ${signed(
                r1(hr?.spPlusOverall ?? 0)
              )}${hfa ? ` + ${hfa} HFA` : " (neutral)"}`}
              model={spreadForm(modelSp)}
              market={mktSpread == null ? null : spreadForm(-mktSpread)}
              edge={spEdge}
            />
            <ModelRow
              name="SRS"
              tag="scoring margin"
              calc={
                hr?.srs != null && ar?.srs != null
                  ? `${awayShort} ${signed(r1(ar.srs))} vs ${homeShort} ${signed(
                      r1(hr.srs)
                    )}${hfa ? ` + ${hfa} HFA` : " (neutral)"}`
                  : "no games played yet — empty in week 1, noisy through ~week 3"
              }
              model={modelSrs == null ? null : spreadForm(modelSrs)}
              market={
                modelSrs == null || mktSpread == null
                  ? null
                  : spreadForm(-mktSpread)
              }
              edge={srsEdge}
            />
          </div>
          <p className="subhead" style={{ marginTop: 12 }}>
            {modelSrs == null
              ? "The spread signal is SP+ only right now."
              : Math.abs(modelSp - modelSrs) > 3
                ? `The two models disagree by ${trim(
                    Math.abs(modelSp - modelSrs)
                  )} pts — treat this as lower confidence (guide §1).`
                : "The two models agree within ~3 pts — the rating signal is stable here."}{" "}
            Market is the consensus of {books} book{books === 1 ? "" : "s"}.
            Positive edge = model likes {home.canonicalName}. Guide §2.
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
              k={`${awayShort} expected`}
              v={trim(r1(pred!.awayExpectedPpp != null ? awayPts(pred!) : 0))}
              sub={`${pred!.awayExpectedPpp != null ? trim(r1(pred!.awayExpectedPpp)) : "–"} pts/poss`}
            />
            <Tile
              k={`${homeShort} expected`}
              v={trim(r1(pred!.homeExpectedPpp != null ? homePts(pred!) : 0))}
              sub={`${pred!.homeExpectedPpp != null ? trim(r1(pred!.homeExpectedPpp)) : "–"} pts/poss`}
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
                mktTotal != null ? `market ${trim(r1(mktTotal))}` : "no market total"
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
            Only SP+ feeds this. Totals are noisier than spreads — the model&apos;s
            biggest UNDER edges cluster on blowouts and are mostly artifacts. Trust
            it most on games with a spread inside ~14. Guide §3.
          </p>
        </>
      )}

      {/* ---------- flags ---------- */}
      <h2>Situational flags</h2>
      {g.gameFlags.length === 0 ? (
        <p className="subhead">No situational flags on this game.</p>
      ) : (
        <div className="mrows">
          {g.gameFlags.map((f) => {
            const dir = HURT_FLAGS.has(f.flagType)
              ? "hurts"
              : HELP_FLAGS.has(f.flagType)
                ? "helps"
                : "";
            const det = flagDetail(f.flagType, f.detail);
            return (
              <div key={f.id} className="mrow">
                <div className="mrow-top">
                  <FlagChip
                    flag={{
                      team: f.team.canonicalName,
                      teamAbbr: f.team.abbreviation,
                      teamId: f.teamId,
                      flagType: f.flagType,
                      detail: f.detail,
                    }}
                  />
                  <strong>{f.team.canonicalName}</strong>
                  {det && <span className="mrow-sub">{det}</span>}
                  {dir && (
                    <span
                      className={`mrow-dir ${dir === "hurts" ? "neg" : "pos"}`}
                    >
                      {dir} {f.team.abbreviation ?? f.team.canonicalName}
                    </span>
                  )}
                </div>
                <div className="mrow-body">{FLAG_MEANING[f.flagType] ?? ""}</div>
              </div>
            );
          })}
        </div>
      )}
      {g.gameFlags.length > 0 && (
        <p className="subhead" style={{ marginTop: 12 }}>
          Flags corroborate, they never drive a pick. A flag against a team the
          model already dislikes is a green light; against a team the model likes,
          it cancels out. Guide §5.
        </p>
      )}

      {/* ---------- line movement ---------- */}
      <h2>Line movement</h2>
      {spreadTL.length === 0 && totalTL.length === 0 ? (
        <p className="subhead">No sportsbook lines captured for this game yet.</p>
      ) : (
        <ul className="hist">
          {mergeTimelines(spreadTL, totalTL).map((row, i) => (
            <li key={i}>
              <span className="hist-when">
                {stampCT(row.at)} <span className="dim">· {row.type}</span>
              </span>
              <span className="hist-vals mono">
                {row.spread != null && (
                  <span>
                    {spreadForm(-row.spread)}
                    {row.spreadRange && (
                      <span className="dim"> ({row.spreadRange})</span>
                    )}
                  </span>
                )}
                {row.total != null && (
                  <span>
                    o/u {trim(r1(row.total))}
                    {row.totalRange && (
                      <span className="dim"> ({row.totalRange})</span>
                    )}
                  </span>
                )}
                <span className="dim">
                  {row.books} book{row.books === 1 ? "" : "s"}
                </span>
              </span>
            </li>
          ))}
        </ul>
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
            <ul className="hist">
              {dedupeWeather([...weather].reverse()).map((w) => (
                <li key={w.id}>
                  <span className="hist-when">{stampCT(w.pulledAt)}</span>
                  <span className="hist-vals mono">
                    <span>{w.tempF == null ? "–" : `${Math.round(w.tempF)}°F`}</span>
                    <span
                      className={
                        w.windMph != null && w.windMph >= 15 ? "wind-hi" : ""
                      }
                    >
                      wind {w.windMph == null ? "–" : trim(r1(w.windMph))}
                    </span>
                    <span className="dim">
                      precip{" "}
                      {w.precipProbability == null
                        ? "–"
                        : `${Math.round(w.precipProbability)}%`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="subhead" style={{ marginTop: 10 }}>
            Sustained wind ≥ 15 mph is the one weather factor that reliably moves a
            total (UNDER). Everything else is minor. Guide §4.
          </p>
        </>
      )}

      {/* ---------- injuries ---------- */}
      <h2>Injuries</h2>
      {g.injuries.length === 0 ? (
        <p className="subhead">
          No impact-player injuries listed. ESPN&apos;s CFB feed is thin — an empty
          report means &quot;unknown,&quot; not &quot;clean.&quot; Guide §4.
        </p>
      ) : (
        <ul className="hist">
          {g.injuries.map((inj) => (
            <li key={inj.id}>
              <span className="hist-when">
                {inj.team.canonicalName} — <strong>{inj.playerName}</strong>
              </span>
              <span className="hist-vals">
                <span className="dim">{inj.position ?? "?"}</span>
                <span style={{ textTransform: "capitalize" }}>{inj.status}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ---------- picks ---------- */}
      <h2>Picks</h2>
      {g.picks.length === 0 ? (
        <p className="subhead">
          No pick logged. Most model disagreements never become picks — see guide
          §6 for the bar.
        </p>
      ) : (
        <div className="mrows">
          {g.picks.map((p) => {
            const flags = Array.isArray(p.flagsPresent)
              ? (p.flagsPresent as string[])
              : [];
            const backHome = p.edge > 0;
            const side =
              p.market === "spread"
                ? backHome
                  ? `${homeShort} ${spreadStr(r1(-p.marketLine))}`
                  : `${awayShort} +${trim(r1(p.marketLine))}`
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
              <div key={p.id} className="mrow mrow-pick">
                <div className="mrow-top">
                  <span className="pick-pill-tag">PICK</span>
                  <strong style={{ fontSize: 15 }}>{side}</strong>
                  <span className="mrow-sub">
                    {p.market} · {p.method} · logged at {signed(r1(p.edge))} edge
                  </span>
                  {p.atsResult && (
                    <span className={`res ${p.atsResult}`} style={{ marginLeft: "auto" }}>
                      {p.atsResult.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="mrow-body mono" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span>model {trim(r1(p.modelLine))}</span>
                  <span>logged {trim(r1(p.marketLine))}</span>
                  <span>close {p.closingLine == null ? "–" : trim(r1(p.closingLine))}</span>
                  <span
                    className={
                      clv == null ? "" : clv > 0 ? "pos" : clv < 0 ? "neg" : ""
                    }
                  >
                    CLV {clv == null ? "–" : signed(clv)}
                  </span>
                </div>
                {flags.length > 0 && (
                  <div className="chips" style={{ marginTop: 8 }}>
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
        <a className="inline-link" href="/guide" style={{ color: "var(--blue)" }}>
          interpretation guide
        </a>
        .
      </p>
    </>
  );
}

// ---------- sub-components ----------

function ModelRow({
  name,
  tag,
  calc,
  model,
  market,
  edge,
}: {
  name: string;
  tag: string;
  calc: string;
  model: string | null;
  market: string | null;
  edge: number | null;
}) {
  const big = edge != null && Math.abs(edge) >= 2.5;
  return (
    <div className="mrow">
      <div className="mrow-top">
        <strong>{name}</strong>
        <span className="mrow-sub">{tag}</span>
        {model && (
          <span className="mono" style={{ marginLeft: "auto" }}>
            model <strong>{model}</strong>
          </span>
        )}
      </div>
      <div className="mrow-body">
        {model ? (
          <span className="mono">
            {market && <>market {market} &nbsp;·&nbsp; </>}
            {edge != null && (
              <span className={big ? (edge > 0 ? "pos" : "neg") : "dim"}>
                edge {signed(edge)}
                {big ? (edge > 0 ? " (home)" : " (away)") : ""}
              </span>
            )}
            <span className="dim"> &nbsp;·&nbsp; {calc}</span>
          </span>
        ) : (
          <span className="dim">{calc}</span>
        )}
      </div>
    </div>
  );
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

// ---------- helpers ----------

function lite(
  t: {
    id: string;
    canonicalName: string;
    abbreviation: string | null;
    logoLight: string | null;
    color: string | null;
    classification: string;
    conference: string | null;
  },
  apRank: number | null = null
) {
  return {
    id: t.id,
    name: t.canonicalName,
    abbr: t.abbreviation,
    logo: t.logoLight,
    color: t.color,
    classification: t.classification,
    conference: t.conference,
    apRank,
  };
}

function shortName(name: string): string {
  return name.length > 16 ? name.split(" ")[0] : name;
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

function dedupeWeather<
  T extends {
    tempF: number | null;
    windMph: number | null;
    precipProbability: number | null;
  },
>(rows: T[]): T[] {
  const out: T[] = [];
  for (const w of rows) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.tempF === w.tempF &&
      prev.windMph === w.windMph &&
      prev.precipProbability === w.precipProbability
    ) {
      continue;
    }
    out.push(w);
  }
  return out;
}
