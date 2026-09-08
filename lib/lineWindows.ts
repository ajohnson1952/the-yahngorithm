// ============================================================
// Bounded Line reads for the every-tick pipeline consumers
// ============================================================
// run-model, generate-picks and compute-market-flags each run on
// every ~30-min heartbeat. A naive `prisma.line.findMany({ where:
// { game: { season, week } } })` pulls the *entire* week's line
// history every time — 40k+ rows by Saturday (wk 1 hit 41,399) —
// and `distinct` / `take` don't help (Prisma applies them after the
// rows are already off the wire). Three consumers × 48 ticks/day
// re-reading all of it was the bulk of the Neon egress.
//
// This is the pipeline twin of the Sept 2 webapp fix
// (lib/webData.ts buildWeekBoard): anchor per game with a groupBy on
// `_max(capturedAt)`, then fetch only each game's latest batch (for
// the current consensus) or a trailing window (for the market-flag
// move scans).
// ============================================================

import type { PrismaClient } from "@prisma/client";
import type { LineRow } from "./consensus";

/** The only six Line columns any downstream consumer actually reads —
 *  keeps id / source / price off the wire. */
export const LINE_SELECT = {
  gameId: true,
  market: true,
  lineValue: true,
  sportsbook: true,
  snapshotType: true,
  capturedAt: true,
} as const;

// one pull run spans ~90 min; ±95 covers a game's whole latest batch
const BATCH_PAD_MS = 95 * 60_000;

async function gameWindows(
  prisma: PrismaClient,
  gameIds: string[],
  backMs: (max: number) => number
) {
  const maxes = await prisma.line.groupBy({
    by: ["gameId"],
    where: { gameId: { in: gameIds } },
    _max: { capturedAt: true },
  });
  return maxes
    .filter((m) => m._max.capturedAt)
    .map((m) => ({
      gameId: m.gameId,
      capturedAt: { gte: new Date(backMs(m._max.capturedAt!.getTime())) },
    }));
}

/**
 * The most recent snapshot batch of Line rows for each of `gameIds` — the only
 * slice {@link consensusByGame} needs. A game's last pull can be hours old
 * (finals, odd sub-slates), so this anchors per game rather than using one
 * global cutoff that would drop those games' numbers entirely.
 */
export async function latestLineBatchByGame(
  prisma: PrismaClient,
  gameIds: string[]
): Promise<LineRow[]> {
  if (gameIds.length === 0) return [];
  const windows = await gameWindows(prisma, gameIds, (max) => max - BATCH_PAD_MS);
  if (windows.length === 0) return [];
  return prisma.line.findMany({ where: { OR: windows }, select: LINE_SELECT });
}

/**
 * Every Line row for `gameIds` from a trailing window anchored on each game's
 * latest snapshot — enough history for compute-market-flags' steam (8 h window)
 * and RLM (30 h trailing) scans without re-reading the whole week each tick.
 * Default 40 h clears the 30 h RLM lookback with room for a snapshot to sit
 * before its cutoff.
 */
export async function recentLinesByGame(
  prisma: PrismaClient,
  gameIds: string[],
  lookbackHours = 40
): Promise<LineRow[]> {
  if (gameIds.length === 0) return [];
  const windows = await gameWindows(
    prisma,
    gameIds,
    (max) => max - lookbackHours * 3_600_000
  );
  if (windows.length === 0) return [];
  return prisma.line.findMany({ where: { OR: windows }, select: LINE_SELECT });
}
