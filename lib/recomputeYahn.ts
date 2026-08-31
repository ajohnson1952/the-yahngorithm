import { db } from "./db";
import { HOME_FIELD_ADVANTAGE } from "./modelConfig";
import { tierRatings, yahnRating } from "./yahn";

/**
 * Recompute predictedSpreadYahn on the latest ModelPrediction per game for a
 * week, from the current YahnRanking. Called after the ranking is edited so
 * the board reflects it without a full model run. Only touches the Yahn
 * field — SP+/SRS/totals snapshots stay frozen.
 */
export async function recomputeYahnSpreads(
  season: number,
  week: number
): Promise<number> {
  const [games, ratings, yahn] = await Promise.all([
    db.game.findMany({
      where: { season, week },
      select: { id: true, homeTeamId: true, awayTeamId: true, neutralSite: true },
    }),
    db.teamRatingWeekly.findMany({
      where: { season, week, spPlusOverall: { not: null } },
      select: { teamId: true, spPlusOverall: true },
    }),
    db.yahnRanking.findMany({
      where: { season },
      select: { teamId: true, rank: true },
    }),
  ]);

  const spByTeam = new Map(ratings.map((r) => [r.teamId, r.spPlusOverall]));
  const rankByTeam = new Map(yahn.map((y) => [y.teamId, y.rank]));
  const tierRates = tierRatings(
    ratings.map((r) => r.spPlusOverall).filter((x): x is number => x != null)
  );
  const yahnFor = (teamId: string) =>
    yahnRating(rankByTeam.get(teamId) ?? null, spByTeam.get(teamId) ?? null, tierRates);

  let updated = 0;
  for (const g of games) {
    const latest = await db.modelPrediction.findFirst({
      where: { gameId: g.id },
      orderBy: { generatedAt: "desc" },
      select: { id: true },
    });
    if (!latest) continue;
    const h = yahnFor(g.homeTeamId);
    const a = yahnFor(g.awayTeamId);
    const hfa = g.neutralSite ? 0 : HOME_FIELD_ADVANTAGE;
    const mYahn = h != null && a != null ? h - a + hfa : null;
    await db.modelPrediction.update({
      where: { id: latest.id },
      data: { predictedSpreadYahn: mYahn },
    });
    updated++;
  }
  return updated;
}
