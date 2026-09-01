// ============================================================
// API usage tracking (for the /admin budget panel)
// ============================================================
// CFBD has no quota endpoint, so 'cfbd' is a best-effort call COUNT —
// each script that hits CFBD reports how many cfbdGet() calls it made
// (see lib/cfbd.ts's getCfbdCallCount()) right before it disconnects.
// A failed run undercounts slightly; that's the safe direction.
//
// The Odds API DOES tell us the real remaining balance via response
// headers, so 'odds' is exact as of the last pull-lines run.
//
// Call these with the SAME PrismaClient instance the script already has
// (and already disconnects) — never open a separate connection here.
// ============================================================

import type { PrismaClient } from "@prisma/client";

const yearMonth = () => new Date().toISOString().slice(0, 7); // "2026-09"

export async function recordCfbdUsage(prisma: PrismaClient, calls: number): Promise<void> {
  if (calls <= 0) return;
  const ym = yearMonth();
  await prisma.apiUsage.upsert({
    where: { api_yearMonth: { api: "cfbd", yearMonth: ym } },
    update: { calls: { increment: calls } },
    create: { api: "cfbd", yearMonth: ym, calls },
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
