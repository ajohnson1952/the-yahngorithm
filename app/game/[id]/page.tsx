import { notFound } from "next/navigation";
import { getGameDetail } from "../../../lib/webData";
import { median } from "../../../lib/consensus";
import { HOME_FIELD_ADVANTAGE } from "../../../lib/modelConfig";
import { probToSpread } from "../../../lib/winProb";
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

interface YahnSide {
  spBase: number;
  epaAdj: number;
  rosterAdj: number;
  rating: number;
}
interface YahnBreak {
  home: YahnSide;
  away: YahnSide;
  hfa: number;
  week: number;
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

  const {
    game: g,
    pred,
    ratings,
    lines,
    weather,
    homeApRank,
    awayApRank,
    homeTrend,
    awayTrend,
    kalshi,
    kalshiHistory,
  } = data;

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
  const modelYahn = pred?.predictedSpreadYahn ?? null;
  const modelTotal = pred?.predictedTotal ?? null;
  const yb = (pred?.yahnBreakdown ?? null) as YahnBreak | null;

  const spEdge =
    modelSp != null && mktHomeMargin != null ? r1(modelSp - mktHomeMargin) : null;
  const srsEdge =
    modelSrs != null && mktHomeMargin != null
      ? r1(modelSrs - mktHomeMargin)
      : null;
  const yahnEdge =
    modelYahn != null && mktHomeMargin != null
      ? r1(modelYahn - mktHomeMargin)
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

  const modelHomeSpread = modelSp != null ? spreadForm(modelSp) : null;

  return (
    <div className="gpage">
      <a
        className="inline-link gback"
        href="/"
        style={{ color: "var(--text-faint)", fontSize: 12 }}
      >
        ← board
      </a>

      <div className="ghero">
        <div className="ghero-teams">
          <GHeroTeam t={lite(away, awayApRank)} score={g.awayScore} won={awayWon} />
          <span className="ghero-at">@</span>
          <GHeroTeam t={lite(home, homeApRank)} score={g.homeScore} won={homeWon} />
        </div>
        <div className="ghero-meta">{meta.join(" · ")}</div>
        <div className="ghero-nums">
          <div className="ghero-num">
            <span className="k">Market spread</span>
            <span className="v mono">
              {mktSpread != null ? spreadForm(-mktSpread) : "—"}
            </span>
          </div>
          <div className="ghero-num">
            <span className="k">Market total</span>
            <span className="v mono">{mktTotal != null ? trim(mktTotal) : "—"}</span>
          </div>
          <div className="ghero-num">
            <span className="k">Model spread</span>
            <span className="v mono">{modelHomeSpread ?? "—"}</span>
          </div>
          <div className="ghero-num">
            <span className="k">Edge</span>
            <span
              className={`v mono ${
                spEdge != null && Math.abs(spEdge) >= 2.5
                  ? spEdge > 0
                    ? "pos"
                    : "neg"
                  : ""
              }`}
            >
              {spEdge != null ? signed(spEdge) : "—"}
            </span>
          </div>
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
            {modelYahn != null && (
              <ModelRow
                name="Yahn"
                tag="SP+ + EPA + roster"
                calc={
                  yb
                    ? `${awayShort} ${signed(yb.away.rating)} vs ${homeShort} ${signed(
                        yb.home.rating
                      )} + ${trim(yb.hfa)} HFA`
                    : "multi-factor composite"
                }
                model={spreadForm(modelYahn)}
                market={mktSpread == null ? null : spreadForm(-mktSpread)}
                edge={yahnEdge}
              />
            )}
          </div>
          {yb && <YahnBreakdownPanel yb={yb} away={awayShort} home={homeShort} />}
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

      {/* ---------- team trends ---------- */}
      <h2>
        Team trends{" "}
        <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>
          · {g.season} season to date
        </span>
      </h2>
      <TrendGrid
        away={awayShort}
        home={homeShort}
        awayTrend={awayTrend as TrendSplits | null}
        homeTrend={homeTrend as TrendSplits | null}
      />

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

      {/* ---------- prediction market ---------- */}
      <h2>
        Prediction market{" "}
        <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>
          · Kalshi
        </span>
      </h2>
      <KalshiPanel
        away={awayShort}
        home={homeShort}
        pm={kalshi}
        history={kalshiHistory}
        bookHomeSpread={mktSpread}
        spreadForm={spreadForm}
      />

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
    </div>
  );
}

function GHeroTeam({
  t,
  score,
  won,
}: {
  t: {
    name: string;
    logo: string | null;
    color: string | null;
    conference: string | null;
    classification: string;
    apRank: number | null;
  };
  score: number | null;
  won: boolean;
}) {
  return (
    <div className={`ghero-team${won ? " won" : ""}`}>
      {t.logo ? (
        <img className="ghero-logo" src={t.logo} alt="" />
      ) : (
        <span
          className="ghero-logo"
          style={{ background: t.color ?? "var(--border)", borderRadius: 8 }}
        />
      )}
      <div className="ghero-name">
        {t.apRank != null && <span className="ap-rank">{t.apRank}</span>}
        {t.name}
      </div>
      <div className="ghero-conf">
        {t.conference ?? ""}
        {t.classification !== "fbs" ? ` · ${t.classification.toUpperCase()}` : ""}
      </div>
      {score != null && <div className="ghero-score mono">{score}</div>}
    </div>
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

function YahnBreakdownPanel({
  yb,
  away,
  home,
}: {
  yb: YahnBreak;
  away: string;
  home: string;
}) {
  const adj = (n: number) => (n === 0 ? "—" : signed(r1(n)));
  const row = (label: string, s: YahnSide) => (
    <div className="mrow">
      <div className="mrow-top">
        <strong>{label}</strong>
        <span className="mono" style={{ marginLeft: "auto" }}>
          rating <strong>{signed(r1(s.rating))}</strong>
        </span>
      </div>
      <div className="mrow-body mono">
        <span className="dim">SP+ base</span> {signed(r1(s.spBase))}
        &nbsp;·&nbsp; <span className="dim">EPA adj</span> {adj(s.epaAdj)}
        &nbsp;·&nbsp; <span className="dim">roster adj</span> {adj(s.rosterAdj)}
      </div>
    </div>
  );
  return (
    <div className="mrows" style={{ marginTop: 10 }}>
      {row(away, yb.away)}
      {row(home, yb.home)}
      <p className="subhead" style={{ margin: "4px 2px 0" }}>
        SP+ is the backbone. <em>EPA adj</em> nudges toward raw efficiency
        (weight grows through the season — near zero this early).{" "}
        <em>Roster adj</em> = talent + returning production + transfer-portal
        net, and fades to zero by week 5. Home edge for this venue:{" "}
        <span className="mono">{trim(yb.hfa)}</span> (2.7 base + altitude or a
        hostile-venue bump; SP+/SRS use a flat 2.5). Weights are un-calibrated
        for now.
      </p>
    </div>
  );
}

type WLP = { w: number; l: number; p: number };
type OU = { over: number; under: number; push: number };
export interface TrendSplits {
  games: number;
  gamesWithLine: number;
  ats: WLP;
  atsHome: WLP;
  atsAway: WLP;
  suHome: WLP;
  suAway: WLP;
  atsFav: WLP;
  atsDog: WLP;
  ou: OU;
  atsAfterWin: WLP;
  atsAfterLoss: WLP;
  outliers: string[];
}

function rec(r?: WLP): string {
  if (!r || r.w + r.l + r.p === 0) return "–";
  return r.p > 0 ? `${r.w}-${r.l}-${r.p}` : `${r.w}-${r.l}`;
}
function pct(r?: WLP): string {
  if (!r) return "";
  const n = r.w + r.l;
  return n === 0 ? "" : ` ${Math.round((r.w / n) * 100)}%`;
}

function TrendCell({
  r,
  outlier,
}: {
  r?: WLP;
  outlier: boolean;
}) {
  return (
    <span className={`trend-cell${outlier ? " trend-outlier" : ""}`}>
      {rec(r)}
      {r && r.w + r.l >= 3 && <span className="trend-pct">{pct(r)}</span>}
    </span>
  );
}

function TrendGrid({
  away,
  home,
  awayTrend,
  homeTrend,
}: {
  away: string;
  home: string;
  awayTrend: TrendSplits | null;
  homeTrend: TrendSplits | null;
}) {
  const anyGames = (awayTrend?.games ?? 0) + (homeTrend?.games ?? 0) > 0;
  if (!anyGames) {
    return (
      <p className="subhead">
        Neither team has enough completed games yet this season.
      </p>
    );
  }
  const rows: { label: string; key: keyof TrendSplits; kind?: "su" }[] = [
    { label: "ATS overall", key: "ats" },
    { label: "ATS at home", key: "atsHome" },
    { label: "ATS on the road", key: "atsAway" },
    { label: "ATS as favorite", key: "atsFav" },
    { label: "ATS as underdog", key: "atsDog" },
    { label: "ATS after a win", key: "atsAfterWin" },
    { label: "ATS after a loss", key: "atsAfterLoss" },
    { label: "W–L at home", key: "suHome", kind: "su" },
    { label: "W–L on the road", key: "suAway", kind: "su" },
  ];
  const cell = (t: TrendSplits | null, key: keyof TrendSplits, su?: boolean) => {
    if (!t) return <span className="trend-cell">–</span>;
    const r = t[key] as WLP;
    const outlier = !su && (t.outliers ?? []).includes(key as string);
    return <TrendCell r={r} outlier={outlier} />;
  };
  const ouCell = (t: TrendSplits | null) => {
    if (!t) return <span className="trend-cell">–</span>;
    const { over, under } = t.ou;
    if (over + under === 0) return <span className="trend-cell">–</span>;
    const outlier =
      (t.outliers ?? []).includes("over") || (t.outliers ?? []).includes("under");
    return (
      <span className={`trend-cell${outlier ? " trend-outlier" : ""}`}>
        {over}O–{under}U
      </span>
    );
  };
  return (
    <>
      <div className="trend-grid">
        <div className="trend-row trend-head">
          <span />
          <span>{away}</span>
          <span>{home}</span>
        </div>
        {rows.map((r) => (
          <div className="trend-row" key={r.key}>
            <span className="trend-label">{r.label}</span>
            {cell(awayTrend, r.key, r.kind === "su")}
            {cell(homeTrend, r.key, r.kind === "su")}
          </div>
        ))}
        <div className="trend-row">
          <span className="trend-label">Over / Under</span>
          {ouCell(awayTrend)}
          {ouCell(homeTrend)}
        </div>
      </div>
      <p className="subhead" style={{ marginTop: 10 }}>
        Amber = an outlier split (≥65% or ≤35% ATS on 8+ games). Trends are
        context, not a signal on their own.
      </p>
    </>
  );
}

interface PMRow {
  capturedAt: Date;
  homeWinProb: number;
  homePrevProb: number | null;
  volume: number;
  volume24h: number;
  openInterest: number;
}

const kNum = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${Math.round(n)}`;

function KalshiPanel({
  away,
  home,
  pm,
  history,
  bookHomeSpread,
  spreadForm,
}: {
  away: string;
  home: string;
  pm: PMRow | null;
  history: PMRow[];
  bookHomeSpread: number | null; // home spread, neg = home favored
  spreadForm: (homeMargin: number) => string;
}) {
  if (!pm) {
    return (
      <p className="subhead">
        No Kalshi market matched to this game (it may not be listed, or the teams
        didn&apos;t resolve). Marquee games have the deepest markets.
      </p>
    );
  }
  const homeProb = pm.homeWinProb;
  const awayProb = 1 - homeProb;
  const kalshiHomeMargin = probToSpread(homeProb);
  const bookHomeMargin = bookHomeSpread == null ? null : -bookHomeSpread;
  const gap =
    bookHomeMargin == null ? null : r1(kalshiHomeMargin - bookHomeMargin);
  const thin = pm.volume < 500;
  const move =
    pm.homePrevProb != null ? r1((homeProb - pm.homePrevProb) * 100) : null;

  return (
    <>
      <div className="kpanel">
        <div className="kpanel-probs">
          <div className="kprob">
            <span className="t">{away}</span>
            <span className="p mono">{(awayProb * 100).toFixed(0)}%</span>
          </div>
          <div className="kprob">
            <span className="t">{home}</span>
            <span className="p mono">{(homeProb * 100).toFixed(0)}%</span>
            {move != null && Math.abs(move) >= 1 && (
              <span className={`m ${move > 0 ? "pos" : "neg"}`}>
                {move > 0 ? "▲" : "▼"} {Math.abs(move)}
              </span>
            )}
          </div>
        </div>
        <div className="kpanel-stats">
          <div>
            <span className="k">Implied line</span>
            <span className="v mono">{spreadForm(kalshiHomeMargin)}</span>
          </div>
          <div>
            <span className="k">Volume</span>
            <span className="v mono">{kNum(pm.volume)}</span>
          </div>
          <div>
            <span className="k">Open interest</span>
            <span className="v mono">{kNum(pm.openInterest)}</span>
          </div>
          <div>
            <span className="k">Traded 24h</span>
            <span className="v mono">{kNum(pm.volume24h)}</span>
          </div>
        </div>
      </div>

      <p className="subhead" style={{ marginTop: 10 }}>
        Kalshi&apos;s market prices {home} to win {(homeProb * 100).toFixed(0)}% —
        about <strong>{spreadForm(kalshiHomeMargin)}</strong>
        {bookHomeMargin != null && (
          <>
            {" "}
            vs the book&apos;s <strong>{spreadForm(bookHomeMargin)}</strong>.{" "}
            {gap != null && Math.abs(gap) < 1.5
              ? "They agree."
              : `${Math.abs(gap!).toFixed(1)}-pt gap — the market rates ${
                  gap! > 0 ? home : away
                } higher than the book.`}
          </>
        )}{" "}
        <em>Volume</em> and <em>open interest</em> are total contracts on the game
        (each settles at $1), not a per-side split — they tell you how much to
        trust the price. {thin && (
          <span style={{ color: "var(--amber)" }}>
            Under 500 here — thin, read lightly.
          </span>
        )}{" "}
        Guide §9.
      </p>

      {history.length > 1 && (
        <ul className="hist">
          {history.map((h, i) => (
            <li key={i}>
              <span className="hist-when">{stampCT(h.capturedAt)}</span>
              <span className="hist-vals mono">
                <span>
                  {home} {(h.homeWinProb * 100).toFixed(0)}%
                </span>
                <span className="dim">{kNum(h.volume)} vol</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
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
