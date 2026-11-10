// ============================================================
// API usage tracking (for the /admin budget panel)
// ============================================================
// 'cfbd' calls is a best-effort call COUNT — each script that hits CFBD
// reports how many cfbdGet() calls it made (see lib/cfbd.ts's
// getCfbdCallCount()) right before it disconnects. A failed run undercounts
// slightly; that's the safe direction. lastRemaining, though, IS exact —
// CFBD returns the real remaining quota via an `x-calllimit-remaining`
// response header (lib/cfbd.ts's getCfbdLastRemaining()), captured here the
// same way the Odds API's remaining balance always has been.
//
// The Odds API DOES tell us the real remaining balance via response
// headers, so 'odds' is exact as of the last pull-lines run.
//
// Call these with the SAME PrismaClient instance the script already has
// (and already disconnects) — never open a separate connection here.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { getCfbdLastRemaining } from "./cfbd";

const yearMonth = () => new Date().toISOString().slice(0, 7); // "2026-09"

export async function recordCfbdUsage(prisma: PrismaClient, calls: number): Promise<void> {
  const remaining = getCfbdLastRemaining();
  if (calls <= 0 && remaining == null) return;
  const ym = yearMonth();
  await prisma.apiUsage.upsert({
    where: { api_yearMonth: { api: "cfbd", yearMonth: ym } },
    update: {
      calls: { increment: calls },
      lastRemaining: remaining ?? undefined,
    },
    create: { api: "cfbd", yearMonth: ym, calls, lastRemaining: remaining },
  });
}

/**
 * CBB Odds key ('odds_cbb'). Unlike 'odds' (which adds up our own call costs),
 * this stores the API's OWN numbers: `calls` = x-requests-used and
 * `lastRemaining` = x-requests-remaining, both exact and overwritten each time.
 * So used + remaining = the real plan size, even after an upgrade.
 * Safe to call with a free balance check (lastCost 0) — that's how a freshly
 * pasted or rotated key gets a correct reading without spending credits.
 */
export async function recordOddsCbbUsage(
  prisma: PrismaClient,
  b: { used: number | null; remaining: number | null; lastCost: number | null }
): Promise<void> {
  if (b.used == null && b.remaining == null) return;
  const ym = yearMonth();
  const data = {
    calls: b.used ?? undefined,
    lastRemaining: b.remaining ?? undefined,
    lastCost: b.lastCost ?? undefined,
  };
  await prisma.apiUsage.upsert({
    where: { api_yearMonth: { api: "odds_cbb", yearMonth: ym } },
    update: data,
    create: { api: "odds_cbb", yearMonth: ym, calls: b.used ?? 0, lastRemaining: b.remaining, lastCost: b.lastCost },
  });
}

export async function recordOddsUsage(
  prisma: PrismaClient,
  opts: { remaining: number | null; cost: number | null }
): Promise<void> {
  const ym = yearMonth();
  await prisma.apiUsage.upsert({
    where: { api_yearMonth: { api: "odds", yearMonth: ym } },
    update: {
      calls: { increment: opts.cost ?? 0 },
      lastRemaining: opts.remaining ?? undefined,
      lastCost: opts.cost ?? undefined,
    },
    create: {
      api: "odds",
      yearMonth: ym,
      calls: opts.cost ?? 0,
      lastRemaining: opts.remaining,
      lastCost: opts.cost,
    },
  });
}
