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
  logo: string | null;
  color: string | null;
  classification: string;
  conference: string | null;
}

export interface FlagView {
  team: string;
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
  home: TeamLite;
  away: TeamLite;
  homeScore: number | null;
  awayScore: number | null;

  marketSpread: number | null; // home spread (neg = home favored)
  marketTotal: number | null;
  books: number;

  modelSpreadSp: number | null; // predicted home margin
  modelSpreadSrs: number | null;
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
}

const r1 = (n: number) => Math.round(n * 10) / 10;

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

export async function getWeekBoard(
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
      gameFlags: { include: { team: { select: { canonicalName: true } } } },
      picks: true,
    },
    orderBy: { kickoffTime: "asc" },
  });

  const gameIds = games.map((g) => g.id);

  const [preds, lines, weather] = await Promise.all([
    db.modelPrediction.findMany({
      where: { gameId: { in: gameIds } },
      orderBy: { generatedAt: "desc" },
    }),
    db.line.findMany({
      where: { gameId: { in: gameIds } },
      select: {
        gameId: true, market: true, lineValue: true,
        sportsbook: true, snapshotType: true, capturedAt: true,
      },
    }),
    db.weather.findMany({
      where: { gameId: { in: gameIds } },
      orderBy: { pulledAt: "desc" },
    }),
  ]);

  const predByGame = new Map<string, (typeof preds)[number]>();
  for (const p of preds) if (!predByGame.has(p.gameId)) predByGame.set(p.gameId, p);

  const wxByGame = new Map<string, (typeof weather)[number]>();
  for (const w of weather) if (!wxByGame.has(w.gameId)) wxByGame.set(w.gameId, w);

  const consensus = consensusByGame(lines);

  const toLite = (t: (typeof games)[number]["homeTeam"]): TeamLite => ({
    id: t.id,
    name: t.canonicalName,
    logo: t.logoLight,
    color: t.color,
    classification: t.classification,
    conference: t.conference,
  });

  const views: GameView[] = games.map((g) => {
    const pred = predByGame.get(g.id);
    const c = consensus.get(g.id);
    const wx = wxByGame.get(g.id);

    const marketSpread = c?.spread ?? null;
    const marketHomeMargin = marketSpread != null ? -marketSpread : null;
    const modelSpreadSp = pred?.predictedSpreadSpPlus ?? null;
    const modelSpreadSrs = pred?.predictedSpreadSrs ?? null;
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
        side: pickSide(p.market, p.edge, p.marketLine, home.name, away.name),
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
      home,
      away,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      marketSpread: marketSpread != null ? r1(marketSpread) : null,
      marketTotal: marketTotal != null ? r1(marketTotal) : null,
      books: c?.books ?? 0,
      modelSpreadSp: modelSpreadSp != null ? r1(modelSpreadSp) : null,
      modelSpreadSrs: modelSpreadSrs != null ? r1(modelSpreadSrs) : null,
      modelTotal: modelTotal != null ? r1(modelTotal) : null,
      predictedPossessions:
        pred?.predictedPossessions != null ? r1(pred.predictedPossessions) : null,
      spreadEdge,
      totalEdge,
      wind: wx?.windMph != null ? r1(wx.windMph) : null,
      tempF: wx?.tempF != null ? Math.round(wx.tempF) : null,
      flags: g.gameFlags.map((f) => ({
        team: f.team.canonicalName,
        teamId: f.teamId,
        flagType: f.flagType,
        detail: f.detail,
      })),
      picks,
      hasModel,
      sortRank,
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

export async function getGameDetail(id: string) {
  const g = await db.game.findUnique({
    where: { id },
    include: {
      homeTeam: true,
      awayTeam: true,
      gameFlags: { include: { team: { select: { canonicalName: true } } } },
      picks: true,
      injuries: { include: { team: { select: { canonicalName: true } } } },
    },
  });
  if (!g) return null;

  const [pred, ratings, lines, weather] = await Promise.all([
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
      orderBy: [{ capturedAt: "asc" }],
    }),
    db.weather.findMany({ where: { gameId: id }, orderBy: { pulledAt: "asc" } }),
  ]);

  return { game: g, pred, ratings, lines, weather };
}

export async function getPickLog(season: number) {
  const picks = await db.pick.findMany({
    where: { game: { season } },
    include: {
      game: {
        include: {
          homeTeam: { select: { canonicalName: true, logoLight: true } },
          awayTeam: { select: { canonicalName: true, logoLight: true } },
        },
      },
    },
    orderBy: { suggestedAt: "desc" },
  });

  const rows = picks.map((p) => ({
    id: p.id,
    gameId: p.gameId,
    week: p.game.week,
    kickoff: p.game.kickoffTime.toISOString(),
    home: p.game.homeTeam.canonicalName,
    away: p.game.awayTeam.canonicalName,
    market: p.market,
    method: p.method,
    modelLine: p.modelLine,
    marketLine: p.marketLine,
    edge: p.edge,
    side: pickSide(
      p.market,
      p.edge,
      p.marketLine,
      p.game.homeTeam.canonicalName,
      p.game.awayTeam.canonicalName
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
