// ============================================================
// Pull Kalshi NCAA-football game markets
// ============================================================
// Prediction-market win probabilities as an independent "fair value"
// reference for the sportsbook line. Snapshotted into PredictionMarket
// (never overwritten) so we can watch the book move relative to it.
//
// Free public API, no auth. ~2 calls per run.
//
// Run:  npm run pull-kalshi                 (auto season/week)
//       npm run pull-kalshi -- --season 2026 --week 3
// ============================================================

import { PrismaClient } from "@prisma/client";
import { getCurrentSeasonWeek } from "../lib/cfbd";
import {
  fetchNcaafMarkets,
  groupByEvent,
  type KalshiGameMarket,
} from "../lib/kalshi";

const prisma = new PrismaClient();

// Kalshi "School Mascot" -> our canonicalName, only where a prefix match fails
const OVERRIDES: Record<string, string> = {
  "Miami RedHawks": "Miami (OH)",
  "Massachusetts Minutemen": "Massachusetts",
  "Louisiana Ragin' Cajuns": "Louisiana",
  "Louisiana-Monroe Warhawks": "UL Monroe",
  "UL Monroe Warhawks": "UL Monroe",
  "Connecticut Huskies": "UConn",
  "Southern Miss Golden Eagles": "Southern Miss",
  "Appalachian State Mountaineers": "App State",
  "Hawai'i Rainbow Warriors": "Hawai'i",
  "Hawaii Rainbow Warriors": "Hawai'i",
  "San José State Spartans": "San José State",
  "San Jose State Spartans": "San José State",
};

function parseArgs() {
  const a = process.argv.slice(2);
  const v = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 && a[i + 1] ? Number(a[i + 1]) : undefined;
  };
  return { season: v("--season"), week: v("--week") };
}

function resolveTeam(
  raw: string,
  byCanonical: Map<string, string>
): string | null {
  if (OVERRIDES[raw]) return byCanonical.get(OVERRIDES[raw]) ?? null;
  // Kalshi abbreviates "State" -> "St." and drops some words
  const kalshiName = raw
    .replace(/\bSt\.\s/g, "State ")
    .replace(/\bSt\.$/g, "State")
    .replace(/\bMiss\.\s/g, "Mississippi ")
    .replace(/\bLa\.\s/g, "Louisiana ");
  if (byCanonical.has(kalshiName)) return byCanonical.get(kalshiName)!;
  // longest canonical name that is a whole-word prefix of the Kalshi string
  let best: { id: string; len: number } | null = null;
  for (const [canon, id] of byCanonical) {
    if (
      kalshiName === canon ||
      kalshiName.startsWith(canon + " ")
    ) {
      if (!best || canon.length > best.len) best = { id, len: canon.length };
    }
  }
  return best?.id ?? null;
}

async function main() {
  const args = parseArgs();
  const auto = await getCurrentSeasonWeek();
  const season = args.season ?? auto.season;
  const week = args.week ?? auto.week;

  console.log(`Kalshi pull — season ${season}, week ${week}\n`);

  const teams = await prisma.team.findMany({
    select: { id: true, canonicalName: true },
  });
  const byCanonical = new Map(teams.map((t) => [t.canonicalName, t.id]));

  const games = await prisma.game.findMany({
    where: { season, week },
    select: { id: true, homeTeamId: true, awayTeamId: true },
  });
  const gameByPair = new Map<string, string>();
  for (const g of games) {
    gameByPair.set([g.homeTeamId, g.awayTeamId].sort().join("|"), g.id);
  }

  const markets = await fetchNcaafMarkets();
  const events = groupByEvent(markets);
  console.log(`Kalshi: ${markets.length} markets, ${events.length} game events.`);

  const rows: {
    gameId: string;
    homeWinProb: number;
    homePrevProb: number | null;
    volume: number;
    volume24h: number;
    openInterest: number;
  }[] = [];
  const unmatched: string[] = [];

  for (const e of events as KalshiGameMarket[]) {
    const idA = resolveTeam(e.teamA, byCanonical);
    const idB = resolveTeam(e.teamB, byCanonical);
    if (!idA || !idB) {
      unmatched.push(`${e.teamA} vs ${e.teamB}`);
      continue;
    }
    const gameId = gameByPair.get([idA, idB].sort().join("|"));
    if (!gameId) continue; // not a game we have this week

    const g = games.find((x) => x.id === gameId)!;
    // orient probabilities to OUR home team
    const homeIsA = g.homeTeamId === idA;
    rows.push({
      gameId,
      homeWinProb: homeIsA ? e.probA : e.probB,
      homePrevProb: homeIsA ? e.prevProbA : e.prevProbA == null ? null : 1 - e.prevProbA,
      volume: e.volume,
      volume24h: e.volume24h,
      openInterest: e.openInterest,
    });
  }

  if (rows.length) {
    await prisma.predictionMarket.createMany({
      data: rows.map((r) => ({ ...r, source: "kalshi" })),
    });
  }

  console.log("\n============================================================");
  console.log(`PredictionMarket snapshots written: ${rows.length}`);
  const highVol = rows.filter((r) => r.volume >= 500).length;
  console.log(`  ...with volume >= 500 contracts:  ${highVol}`);
  if (unmatched.length) {
    console.log(
      `\nKalshi events not matched to a team (${unmatched.length}):\n  ` +
        unmatched.slice(0, 25).join("\n  ")
    );
  }
  console.log("============================================================");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
