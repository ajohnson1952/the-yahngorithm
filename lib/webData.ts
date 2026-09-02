import { unstable_cache } from "next/cache";
import { db } from "./db";
import { consensusByGame } from "./consensus";
import {
  SPREAD_EDGE_THRESHOLD,
  TOTAL_EDGE_THRESHOLD,
  LARGE_SPREAD_CAP,
  TOTALS_COMPETITIVE_CAP,
} from "./modelConfig";

export interface TeamLite {
  id: string;
  name: string;
  abbr: string | null;
  logo: string | null;
  color: string | null;
  classification: string;
  conference: string | null;
  apRank: number | null;
}

export interface FlagView {
  team: string;
  teamAbbr: string | null;
  teamId: string;
  flagType: string;
  detail: unknown;
}

export interface PickView {
  market: string;
  method: string;
  modelLine: number;
  marketLine: number;
  edge: number;
  flags: string[];
  side: string;
  atsResult: string | null;
  actualResult: number | null;
  closingLine: number | null;
  clv: number | null;
}

export interface GameView {
  id: string;
  season: number;
  week: number;
  kickoff: string;
  status: string;
  neutralSite: boolean;
  indoor: boolean;
  venue: string | null;
  broadcast: string | null;
  home: TeamLite;
  away: TeamLite;
  homeScore: number | null;
  awayScore: number | null;

  marketSpread: number | null; // home spread (neg = home favored)
  marketTotal: number | null;
  books: number;

  modelSpreadSp: number | null; // predicted home margin
  modelSpreadSrs: number | null;
  modelSpreadYahn: number | null;
  modelTotal: number | null;
  predictedPossessions: number | null;

  spreadEdge: number | null; // model home margin - market home margin
  totalEdge: number | null;

  wind: number | null;
  tempF: number | null;

  flags: FlagView[];
  picks: PickView[];

  hasModel: boolean;
  sortRank: number;
  pinned: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

const WEATHER_FLAG_TYPES = new Set(["heat", "cold", "wind", "rain", "snow"]);
/** chip display order: bad_spot headline, then situational/market, weather last */
const rank = (flagType: string) =>
  flagType === "bad_spot" ? 0 : WEATHER_FLAG_TYPES.has(flagType) ? 2 : 1;

/** AP rank per teamId for a given week — falls back to the most recent poll
 *  published on or before that week (handy in the gap before a week's poll drops). */
async function apRankMap(
  season: number,
  week: number
): Promise<Map<string, number>> {
  const latest = await db.ranking.findFirst({
    where: { season, poll: "ap", week: { lte: week } },
    orderBy: { week: "desc" },
    select: { week: true },
  });
  if (!latest) return new Map();
  const ranks = await db.ranking.findMany({
    where: { season, poll: "ap", week: latest.week },
    select: { teamId: true, rank: true },
  });
  return new Map(ranks.map((r) => [r.teamId, r.rank]));
}

function pickSide(
  market: string,
  edge: number,
  marketLine: number,
  homeName: string,
  awayName: string
): string {
  if (market === "spread") {
    return edge > 0
      ? `${homeName} ${r1(-marketLine)}`
      : `${awayName} +${r1(marketLine)}`;
  }
  return `${edge > 0 ? "Over" : "Under"} ${r1(marketLine)}`;
}

function clvOf(p: {
  edge: number;
  marketLine: number;
  closingLine: number | null;
}): number | null {
  if (p.closingLine == null) return null;
  const backHome = p.edge > 0;
  return r1(backHome ? p.closingLine - p.marketLine : p.marketLine - p.closingLine);
}

/** How long the per-week board stays cached (seconds). The pipeline refreshes
 *  the underlying data every ~30 min; this window just stops a burst of visitors
 *  from each re-running the board's queries (a full `force-dynamic` homepage
 *  doing exactly that is what blew the Neon transfer cap). */
const WEEK_BOARD_TTL = 120;

const cachedWeekBoard = unstable_cache(buildWeekBoard, ["week-board"], {
  revalidate: WEEK_BOARD_TTL,
  tags: ["week-board"],
});

/** The per-week board, WITHOUT per-visitor pin state — cached in the Next data
 *  cache keyed on (season, week). Callers layer pins on top via
 *  {@link getPinnedGameIds}, which is a cheap uncached per-visitor lookup. */
export function getWeekBoard(season: number, week: number): Promise<GameView[]> {
  return cachedWeekBoard(season, week);
}

/** Game ids this visitor has pinned. Tiny (a visitor pins a handful of games),
 *  so we fetch them all rather than filtering by the current week's ids. */
export async function getPinnedGameIds(uid: string): Promise<Set<string>> {
  if (!uid) return new Set();
  const rows = await db.pinnedGame.findMany({
    where: { uid },
    select: { gameId: true },
  });
  return new Set(rows.map((r) => r.gameId));
}

async function buildWeekBoard(
  season: number,
  week: number
): Promise<GameView[]> {
  const games = await db.game.findMany({
    where: {
      season,
      week,
      OR: [
        { homeTeam: { classification: "fbs" } },
        { awayTeam: { classification: "fbs" } },
      ],
    },
    include: {
      homeTeam: true,
      awayTeam: true,
      gameFlags: {
        include: { team: { select: { canonicalName: true, abbreviation: true } } },
      },
      picks: true,
    },
    orderBy: { kickoffTime: "asc" },
  });

  const gameIds = games.map((g) => g.id);

  // Only the newest generation batch of predictions and the newest pull-run of
  // lines are ever read below — everything older is history we'd pay Neon
  // egress for and immediately discard. `distinct` / `take` won't help here
  // (Prisma applies them after the rows are already off the wire), so first
  // find where the newest batch starts, then fetch only that slice.
  const [newestPred, newestLine] = await Promise.all([
    db.modelPrediction.findFirst({
      where: { gameId: { in: gameIds } },
      orderBy: { generatedAt: "desc" },
      select: { generatedAt: true },
    }),
    db.line.findFirst({
      where: { gameId: { in: gameIds } },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    }),
  ]);
  // one model run writes every game in a couple of minutes; one line pull-run
  // spans ~90 min. Widen each a little for slack, and when the table has
  // nothing for these games fall back to "everything" (which is also nothing).
  const predsSince = newestPred
    ? new Date(newestPred.generatedAt.getTime() - 60 * 60_000)
    : new Date(0);
  const linesSince = newestLine
    ? new Date(newestLine.capturedAt.getTime() - 95 * 60_000)
    : new Date(0);

  const [preds, lines, weather, apRanks] = await Promise.all([
    db.modelPrediction.findMany({
      where: { gameId: { in: gameIds }, generatedAt: { gte: predsSince } },
      orderBy: { generatedAt: "desc" },
      select: {
        gameId: true,
        predictedSpreadSpPlus: true,
        predictedSpreadSrs: true,
        predictedSpreadYahn: true,
        predictedTotal: true,
        predictedPossessions: true,
      },
    }),
    db.line.findMany({
      where: { gameId: { in: gameIds }, capturedAt: { gte: linesSince } },
      select: {
        gameId: true, market: true, lineValue: true,
        sportsbook: true, snapshotType: true, capturedAt: true,
      },
    }),
    db.weather.findMany({
      where: { gameId: { in: gameIds } },
      orderBy: { pulledAt: "desc" },
    }),
    apRankMap(season, week),
  ]);

  const predByGame = new Map<string, (typeof preds)[number]>();
  for (const p of preds) if (!predByGame.has(p.gameId)) predByGame.set(p.gameId, p);

  const wxByGame = new Map<string, (typeof weather)[number]>();
  for (const w of weather) if (!wxByGame.has(w.gameId)) wxByGame.set(w.gameId, w);

  const consensus = consensusByGame(lines);

  const toLite = (t: (typeof games)[number]["homeTeam"]): TeamLite => ({
    id: t.id,
    name: t.canonicalName,
    abbr: t.abbreviation,
    logo: t.logoLight,
    color: t.color,
    classification: t.classification,
    conference: t.conference,
    apRank: apRanks.get(t.id) ?? null,
  });

  const views: GameView[] = games.map((g) => {
    const pred = predByGame.get(g.id);
    const c = consensus.get(g.id);
    const wx = wxByGame.get(g.id);

    const marketSpread = c?.spread ?? null;
    const marketHomeMargin = marketSpread != null ? -marketSpread : null;
    const modelSpreadSp = pred?.predictedSpreadSpPlus ?? null;
    const modelSpreadSrs = pred?.predictedSpreadSrs ?? null;
    const modelSpreadYahn = pred?.predictedSpreadYahn ?? null;
    const modelTotal = pred?.predictedTotal ?? null;
    const marketTotal = c?.total ?? null;

    const spreadEdge =
      modelSpreadSp != null && marketHomeMargin != null
        ? r1(modelSpreadSp - marketHomeMargin)
        : null;
    const totalEdge =
      modelTotal != null && marketTotal != null
        ? r1(modelTotal - marketTotal)
        : null;

    const home = toLite(g.homeTeam);
    const away = toLite(g.awayTeam);

    const picks: PickView[] = g.picks.map((p) => {
      const clv = clvOf(p);
      return {
        market: p.market,
        method: p.method,
        modelLine: p.modelLine,
        marketLine: p.marketLine,
        edge: p.edge,
        flags: Array.isArray(p.flagsPresent) ? (p.flagsPresent as string[]) : [],
        side: pickSide(
          p.market,
          p.edge,
          p.marketLine,
          home.abbr ?? home.name,
          away.abbr ?? away.name
        ),
        atsResult: p.atsResult,
        actualResult: p.actualResult,
        closingLine: p.closingLine,
        clv,
      };
    });

    const hasModel = modelSpreadSp != null;
    const spreadMag = marketSpread != null ? Math.abs(marketSpread) : Infinity;
    // an edge that would actually be actionable (survives the pick-gen filters)
    const actionableSpread =
      spreadEdge != null &&
      Math.abs(spreadEdge) >= SPREAD_EDGE_THRESHOLD &&
      spreadMag <= LARGE_SPREAD_CAP;
    const actionableTotal =
      totalEdge != null &&
      Math.abs(totalEdge) >= TOTAL_EDGE_THRESHOLD &&
      spreadMag <= TOTALS_COMPETITIVE_CAP;
    const rawEdge =
      (spreadEdge != null && Math.abs(spreadEdge) >= SPREAD_EDGE_THRESHOLD) ||
      (totalEdge != null && Math.abs(totalEdge) >= TOTAL_EDGE_THRESHOLD);

    let sortRank = 5;
    if (picks.length > 0) sortRank = 0;
    else if (actionableSpread || actionableTotal) sortRank = 1;
    else if (g.gameFlags.length > 0 && hasModel) sortRank = 2;
    else if (rawEdge) sortRank = 3; // edge exists but it's a blowout artifact
    else if (hasModel) sortRank = 4;
    else sortRank = 6; // FBS-vs-FCS, no model

    return {
      id: g.id,
      season: g.season,
      week: g.week,
      kickoff: g.kickoffTime.toISOString(),
      status: g.status,
      neutralSite: g.neutralSite,
      indoor: g.indoor,
      venue: g.venue,
      broadcast: g.broadcast,
      home,
      away,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      marketSpread: marketSpread != null ? r1(marketSpread) : null,
      marketTotal: marketTotal != null ? r1(marketTotal) : null,
      books: c?.books ?? 0,
      modelSpreadSp: modelSpreadSp != null ? r1(modelSpreadSp) : null,
      modelSpreadSrs: modelSpreadSrs != null ? r1(modelSpreadSrs) : null,
      modelSpreadYahn: modelSpreadYahn != null ? r1(modelSpreadYahn) : null,
      modelTotal: modelTotal != null ? r1(modelTotal) : null,
      predictedPossessions:
        pred?.predictedPossessions != null ? r1(pred.predictedPossessions) : null,
      spreadEdge,
      totalEdge,
      wind: wx?.windMph != null ? r1(wx.windMph) : null,
      tempF: wx?.tempF != null ? Math.round(wx.tempF) : null,
      flags: g.gameFlags
        .map((f) => ({
          team: f.team.canonicalName,
          teamAbbr: f.team.abbreviation,
          teamId: f.teamId,
          flagType: f.flagType,
          detail: f.detail,
        }))
        // bad_spot first (the headline), weather chips last, situational between
        .sort((a, b) => rank(a.flagType) - rank(b.flagType)),
      picks,
      hasModel,
      sortRank,
      pinned: false, // layered on per-visitor by the caller (see getPinnedGameIds)
    };
  });

  views.sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    const ae = Math.max(Math.abs(a.spreadEdge ?? 0), Math.abs(a.totalEdge ?? 0));
    const be = Math.max(Math.abs(b.spreadEdge ?? 0), Math.abs(b.totalEdge ?? 0));
    if (ae !== be) return be - ae;
    return Date.parse(a.kickoff) - Date.parse(b.kickoff);
  });

  return views;
}

export async function getGameDetail(id: string, uid: string) {
  const g = await db.game.findUnique({
    where: { id },
    include: {
      homeTeam: true,
      awayTeam: true,
      gameFlags: {
        include: { team: { select: { canonicalName: true, abbreviation: true } } },
      },
      picks: true,
      injuries: { include: { team: { select: { canonicalName: true } } } },
      pins: { where: { uid }, select: { gameId: true } },
    },
  });
  if (!g) return null;

  const [pred, ratings, lines, weather, apRanks] = await Promise.all([
    db.modelPrediction.findFirst({
      where: { gameId: id },
      orderBy: { generatedAt: "desc" },
    }),
    db.teamRatingWeekly.findMany({
      where: {
        season: g.season,
        week: g.week,
        teamId: { in: [g.homeTeamId, g.awayTeamId] },
      },
    }),
    db.line.findMany({
      where: { gameId: id },
      // one game's line history is naturally bounded (open -> kickoff), but only
      // these six columns are read downstream — skip id/gameId/source over the wire
      select: {
        sportsbook: true, market: true, lineValue: true,
        price: true, snapshotType: true, capturedAt: true,
      },
      orderBy: [{ capturedAt: "asc" }],
    }),
    db.weather.findMany({ where: { gameId: id }, orderBy: { pulledAt: "asc" } }),
    apRankMap(g.season, g.week),
  ]);

  const [trends, kalshi] = await Promise.all([
    db.teamTrend.findMany({
      where: { season: g.season, teamId: { in: [g.homeTeamId, g.awayTeamId] } },
    }),
    db.predictionMarket.findMany({
      where: { gameId: id },
      orderBy: { capturedAt: "desc" },
      take: 12,
    }),
  ]);

  return {
    game: g,
    pinned: g.pins.length > 0,
    pred,
    ratings,
    lines,
    weather,
    homeApRank: apRanks.get(g.homeTeamId) ?? null,
    awayApRank: apRanks.get(g.awayTeamId) ?? null,
    homeTrend: trends.find((t) => t.teamId === g.homeTeamId)?.splits ?? null,
    awayTrend: trends.find((t) => t.teamId === g.awayTeamId)?.splits ?? null,
    kalshi: kalshi[0] ?? null,
    kalshiHistory: [...kalshi].reverse(), // oldest -> newest
  };
}

/** Pick log is append-mostly: a new row appears only when a fresh edge clears
 *  the filters, and results/CLV land after `grade-picks` runs post-final. A few
 *  minutes of lag is invisible here. */
const PICK_LOG_TTL = 10 * 60;

const cachedPickLog = unstable_cache(buildPickLog, ["pick-log"], {
  revalidate: PICK_LOG_TTL,
  tags: ["pick-log"],
});

export function getPickLog(season: number) {
  return cachedPickLog(season);
}

async function buildPickLog(season: number) {
  const picks = await db.pick.findMany({
    where: { game: { season } },
    include: {
      game: {
        include: {
          homeTeam: {
            select: { canonicalName: true, abbreviation: true, logoLight: true },
          },
          awayTeam: {
            select: { canonicalName: true, abbreviation: true, logoLight: true },
          },
        },
      },
    },
    orderBy: { suggestedAt: "desc" },
  });

  const apRows = await db.ranking.findMany({
    where: { season, poll: "ap" },
    select: { week: true, teamId: true, rank: true },
  });
  const apByWeekTeam = new Map(
    apRows.map((r) => [`${r.week}:${r.teamId}`, r.rank])
  );

  const rows = picks.map((p) => ({
    id: p.id,
    gameId: p.gameId,
    week: p.game.week,
    kickoff: p.game.kickoffTime.toISOString(),
    home: p.game.homeTeam.canonicalName,
    away: p.game.awayTeam.canonicalName,
    homeAbbr: p.game.homeTeam.abbreviation,
    awayAbbr: p.game.awayTeam.abbreviation,
    homeRank: apByWeekTeam.get(`${p.game.week}:${p.game.homeTeamId}`) ?? null,
    awayRank: apByWeekTeam.get(`${p.game.week}:${p.game.awayTeamId}`) ?? null,
    market: p.market,
    method: p.method,
    modelLine: p.modelLine,
    marketLine: p.marketLine,
    edge: p.edge,
    side: pickSide(
      p.market,
      p.edge,
      p.marketLine,
      p.game.homeTeam.abbreviation ?? p.game.homeTeam.canonicalName,
      p.game.awayTeam.abbreviation ?? p.game.awayTeam.canonicalName
    ),
    flags: Array.isArray(p.flagsPresent) ? (p.flagsPresent as string[]) : [],
    atsResult: p.atsResult,
    actualResult: p.actualResult,
    closingLine: p.closingLine,
    clv: clvOf(p),
  }));

  const graded = rows.filter((r) => r.atsResult);
  const record = {
    win: graded.filter((r) => r.atsResult === "win").length,
    loss: graded.filter((r) => r.atsResult === "loss").length,
    push: graded.filter((r) => r.atsResult === "push").length,
  };
  const clvs = rows.map((r) => r.clv).filter((x): x is number => x != null);
  const clvAvg = clvs.length ? r1(clvs.reduce((a, b) => a + b, 0) / clvs.length) : null;
  const clvBeat = clvs.filter((x) => x > 0).length;

  return { rows, record, clvAvg, clvBeat, clvCount: clvs.length };
}

export interface GradeRow {
  key: string;
  label: string;
  kind: "model" | "flag";
  win: number;
  loss: number;
  push: number;
  n: number;
  rate: number | null; // win rate on decided (null if none)
  mae: number | null; // models only
  closeMae: number | null; // the closing line's MAE over this model's same games
  bigWin: number; // edge>=2 subset (models only)
  bigLoss: number;
}

const GRADE_LABEL: Record<string, string> = {
  sp_plus: "SP+ model",
  srs: "SRS model",
  yahn: "Yahn model",
};

const meanAbs = (a: number[]) =>
  a.length ? r1(a.reduce((s, x) => s + Math.abs(x), 0) / a.length) : null;

/** Season-to-date scoreboard: each spread model + each flag vs the closing line.
 *  A row only moves when a game goes final and `grade-picks` runs, so a ~15-min
 *  cache is invisible — the numbers are stable between results. */
const GRADE_BOARD_TTL = 15 * 60;

const cachedGradeBoard = unstable_cache(buildGradeBoard, ["grade-board"], {
  revalidate: GRADE_BOARD_TTL,
  tags: ["grade-board"],
});

export function getGradeBoard(season: number) {
  return cachedGradeBoard(season);
}

async function buildGradeBoard(season: number) {
  const grades = await db.modelGrade.findMany({
    where: { season },
    select: {
      gameId: true, key: true, result: true, edge: true,
      absError: true, closeMargin: true, actualMargin: true,
    },
  });

  const keys = [...new Set(grades.map((g) => g.key))];
  const order = (k: string) =>
    k === "sp_plus" ? 0 : k === "srs" ? 1 : k === "yahn" ? 2 : 10;

  const rows: GradeRow[] = keys
    .map((key) => {
      const g = grades.filter((x) => x.key === key);
      const win = g.filter((x) => x.result === "win").length;
      const loss = g.filter((x) => x.result === "loss").length;
      const push = g.filter((x) => x.result === "push").length;
      const n = win + loss;
      const isModel = !key.startsWith("flag:");
      const errs = g.map((x) => x.absError).filter((x): x is number => x != null);
      const big = g.filter((x) => (x.edge ?? 0) >= 2);
      return {
        key,
        label: GRADE_LABEL[key] ?? key.replace("flag:", ""),
        kind: (isModel ? "model" : "flag") as "model" | "flag",
        win,
        loss,
        push,
        n,
        rate: n ? win / n : null,
        mae: meanAbs(errs),
        // closing line's MAE over exactly the games this model graded
        closeMae: isModel
          ? meanAbs(g.map((x) => x.closeMargin - x.actualMargin))
          : null,
        bigWin: big.filter((x) => x.result === "win").length,
        bigLoss: big.filter((x) => x.result === "loss").length,
      };
    })
    .sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label));

  const byGame = new Map(grades.map((g) => [g.gameId, g]));
  const closeMaeAll = meanAbs(
    [...byGame.values()].map((g) => g.closeMargin - g.actualMargin)
  );

  return { rows, gamesGraded: byGame.size, closeMaeAll };
}

const CFBD_MONTHLY_BUDGET = 1000;
const ODDS_MONTHLY_BUDGET = 500;

export interface ApiUsageView {
  cfbdCalls: number;
  cfbdBudget: number;
  oddsUsed: number; // budget - remaining, when we know remaining
  oddsRemaining: number | null;
  oddsBudget: number;
  updatedAt: Date | null;
}

export interface FreshnessRow {
  label: string;
  at: Date | null;
  source: string;
  /** age past which this row is considered stale (amber); 2× = red */
  warnHrs: number;
}

/** "When did each data source last update?" — the /admin heartbeat panel.
 *  Answers the recurring "did the automation actually run?" question. */
export async function getDataFreshness(): Promise<FreshnessRow[]> {
  const latest = async (
    q: Promise<{ [k: string]: unknown } | null>,
    field: string
  ): Promise<Date | null> => {
    const row = await q;
    const v = row?.[field];
    return v instanceof Date ? v : null;
  };

  const [tick, lines, model, kalshi, scores, weather, grades, picks, ratings, trends] =
    await Promise.all([
      latest(db.meta.findUnique({ where: { key: "lastTick" } }), "updatedAt"),
      latest(db.line.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }), "capturedAt"),
      latest(db.modelPrediction.findFirst({ orderBy: { generatedAt: "desc" }, select: { generatedAt: true } }), "generatedAt"),
      latest(db.predictionMarket.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }), "capturedAt"),
      latest(db.game.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }), "updatedAt"),
      latest(db.weather.findFirst({ orderBy: { pulledAt: "desc" }, select: { pulledAt: true } }), "pulledAt"),
      latest(db.modelGrade.findFirst({ orderBy: { gradedAt: "desc" }, select: { gradedAt: true } }), "gradedAt"),
      latest(db.pick.findFirst({ orderBy: { suggestedAt: "desc" }, select: { suggestedAt: true } }), "suggestedAt"),
      latest(db.teamRatingWeekly.findFirst({ orderBy: { pulledAt: "desc" }, select: { pulledAt: true } }), "pulledAt"),
      latest(db.teamTrend.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } }), "computedAt"),
    ]);

  return [
    // The real health check: did the scheduler fire? (cron-job.org → tick.ts)
    { label: "Scheduler (last tick)", at: tick, source: "cron-job.org → tick.ts · every 30 min", warnHrs: 1 },
    // Every-tick sources — if the scheduler is green, these should be too.
    { label: "Model (spreads + totals)", at: model, source: "run-model · every tick", warnHrs: 3 },
    { label: "Kalshi markets", at: kalshi, source: "pull-kalshi · every tick", warnHrs: 3 },
    // Game-window / weekly sources — a lull between runs is normal, not a fault.
    { label: "Betting lines", at: lines, source: "pull-lines · game windows", warnHrs: 14 },
    { label: "Scores / schedule", at: scores, source: "pull-games · game windows + Tue", warnHrs: 20 },
    { label: "Weather", at: weather, source: "pull-weather · ~6am & ~4pm", warnHrs: 20 },
    // Event-driven / weekly — informational only, never a fault on their own.
    { label: "Picks", at: picks, source: "generate-picks · new row only on a new edge", warnHrs: 999 },
    { label: "Grades", at: grades, source: "grade-picks · new row only after a final", warnHrs: 999 },
    { label: "Ratings (SP+ / SRS)", at: ratings, source: "pull-ratings · Tuesdays", warnHrs: 999 },
    { label: "Team trends", at: trends, source: "compute-trends · Sundays", warnHrs: 999 },
  ];
}

/** Current-month usage for the /admin budget panel. */
export async function getApiUsage(): Promise<ApiUsageView> {
  const ym = new Date().toISOString().slice(0, 7);
  const rows = await db.apiUsage.findMany({ where: { yearMonth: ym } });
  const cfbd = rows.find((r) => r.api === "cfbd");
  const odds = rows.find((r) => r.api === "odds");
  const updates = [cfbd?.updatedAt, odds?.updatedAt].filter((x): x is Date => x != null);
  return {
    cfbdCalls: cfbd?.calls ?? 0,
    cfbdBudget: CFBD_MONTHLY_BUDGET,
    oddsUsed: odds?.lastRemaining != null ? ODDS_MONTHLY_BUDGET - odds.lastRemaining : odds?.calls ?? 0,
    oddsRemaining: odds?.lastRemaining ?? null,
    oddsBudget: ODDS_MONTHLY_BUDGET,
    updatedAt: updates.length ? new Date(Math.max(...updates.map((d) => d.getTime()))) : null,
  };
}
