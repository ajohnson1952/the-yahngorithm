// ============================================================
// Public read-only feed for Cavepicks (the owner's pick'em app).
// ============================================================
// One week's games with: the yahngorithm game-page URL, each team's exact
// Odds API name(s) (Cavepicks stores teams under those, so it can match a
// game without sharing ids), and the model's logged picks. Cavepicks uses it
// for the Joe badge link, the "Yahn's pick" marks and its helper page.
//
// Everything here comes from caches the tick already refreshes and warms
// (week board, pick log) plus one small cached alias lookup — so serving the
// feed never wakes Neon on its own. See lib/pipelineCache.ts.
// ============================================================

import { unstable_cache } from "next/cache";
import { db } from "./db";
import { getWeekBoard, getPickLog } from "./webData";
import { PIPELINE_TAG, PIPELINE_TTL, SITE_URL } from "./pipelineCache";
import { spreadToProb } from "./winProb";

const cachedOddsNames = unstable_cache(
  async () =>
    db.teamSourceAlias.findMany({
      where: { source: "odds_api" },
      select: { teamId: true, sourceName: true },
    }),
  ["odds-api-names"],
  { revalidate: PIPELINE_TTL, tags: ["odds-api-names", PIPELINE_TAG] }
);

export interface FeedPick {
  market: "spread" | "total";
  /** which side the model took */
  side: "home" | "away" | "over" | "under";
  /** display text as logged, e.g. "Tennessee -13.5" / "Under 57.5" */
  label: string;
  /** size of the model's disagreement with the market, in points (always +) */
  edge: number;
  /** what corroborated it (srs, revenge, travel, wind, …) */
  why: string[];
  result: string | null; // win | loss | push once graded
  /** when the model logged it — Cavepicks' ghost player only counts picks
   *  that existed before a game's lock deadline */
  loggedAt: string | null;
}

export interface FeedTeam {
  name: string;
  abbr: string | null;
  oddsNames: string[];
}

export interface FeedGame {
  id: string;
  url: string;
  kickoff: string;
  home: FeedTeam;
  away: FeedTeam;
  /** the model's chance the HOME team wins outright (0..1), null if no model
   *  — Cavepicks' ghost player uses it to choose its underdog */
  homeWinProb: number | null;
  picks: FeedPick[];
}

export interface YahnFeed {
  season: number;
  week: number;
  site: string;
  /** season-to-date record of the logged picks */
  record: { win: number; loss: number; push: number };
  games: FeedGame[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function buildFeed(season: number, week: number): Promise<YahnFeed> {
  const [board, aliases, log] = await Promise.all([
    getWeekBoard(season, week),
    cachedOddsNames(),
    getPickLog(season),
  ]);

  const namesByTeam = new Map<string, string[]>();
  for (const a of aliases) {
    const arr = namesByTeam.get(a.teamId);
    if (arr) arr.push(a.sourceName);
    else namesByTeam.set(a.teamId, [a.sourceName]);
  }
  const team = (t: { id: string; name: string; abbr: string | null }): FeedTeam => ({
    name: t.name,
    abbr: t.abbr,
    oddsNames: namesByTeam.get(t.id) ?? [],
  });

  return {
    season,
    week,
    site: SITE_URL,
    record: { win: log.record.win, loss: log.record.loss, push: log.record.push },
    games: board.map((g) => ({
      id: g.id,
      url: `${SITE_URL}/game/${g.id}`,
      kickoff: g.kickoff,
      home: team(g.home),
      away: team(g.away),
      homeWinProb:
        g.modelSpreadSp != null ? Math.round(spreadToProb(g.modelSpreadSp) * 1000) / 1000 : null,
      picks: g.picks
        .filter((p) => p.market === "spread" || p.market === "total")
        .map((p) => ({
          market: p.market as "spread" | "total",
          // edge > 0 = model likes the home side / the over
          side:
            p.market === "spread"
              ? p.edge > 0 ? "home" : "away"
              : p.edge > 0 ? "over" : "under",
          label: p.side,
          edge: r1(Math.abs(p.edge)),
          why: p.flags,
          result: p.atsResult,
          loggedAt: p.loggedAt ?? null,
        })),
    })),
  };
}
