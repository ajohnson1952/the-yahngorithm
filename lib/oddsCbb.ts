// ============================================================
// The Odds API — college basketball (CBB)
// ============================================================
// Uses its OWN key, ODDS_API_KEY_CBB (a third the-odds-api.com account).
// The CFB key (ODDS_API_KEY) and Cavepicks' key are separate accounts with
// their own 500/mo free credits — never mix them.
//
// Cost model: 1 credit per market per region per call. Asking for one book
// (bookmakers=fanduel) counts as one region, so moneyline + spread = 2
// credits a pull, + totals = 3. Listing sports (/sports) is FREE, and every
// response carries the account's exact balance in its headers — that's how
// checkOddsCbbBalance() reads usage without spending anything.
//
// Every call returns the balance; callers pass it to recordOddsCbbUsage()
// (lib/apiUsage.ts) so /admin's "Odds API (CBB)" bar stays exact.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import type { OddsEvent } from "./oddsApi";
import { recordOddsCbbUsage } from "./apiUsage";

const ODDS_BASE = "https://api.the-odds-api.com/v4";
export const CBB_SPORT_KEY = "basketball_ncaab";

/** Skip paid pulls below this many credits left (see oddsCbbFloorCheck). */
export const ODDS_CBB_FLOOR = 15;

export function getOddsCbbKey(): string | null {
  const k = process.env.ODDS_API_KEY_CBB?.trim();
  return k ? k : null;
}

export function requireOddsCbbKey(): string {
  const key = getOddsCbbKey();
  if (!key) {
    throw new Error(
      "Missing ODDS_API_KEY_CBB. Add it to .env (its own the-odds-api.com " +
        "account — not the CFB key or the Cavepicks key)."
    );
  }
  return key;
}

/** Exact account balance, straight from the Odds API's response headers. */
export interface OddsBalance {
  used: number | null; // credits used this month (x-requests-used)
  remaining: number | null; // credits left this month (x-requests-remaining)
  lastCost: number | null; // what THIS call cost (x-requests-last)
}

function readBalance(res: Response): OddsBalance {
  const num = (h: string) => {
    const v = res.headers.get(h);
    return v == null || v === "" ? null : Number(v);
  };
  return {
    used: num("x-requests-used"),
    remaining: num("x-requests-remaining"),
    lastCost: num("x-requests-last"),
  };
}

/** Free (0-credit) balance check. Also proves a newly pasted key works. */
export async function checkOddsCbbBalance(): Promise<OddsBalance> {
  const key = requireOddsCbbKey();
  const res = await fetch(`${ODDS_BASE}/sports?apiKey=${key}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // never echo the URL — it contains the key
    throw new Error(`Odds API (CBB) balance check -> ${res.status} ${res.statusText}`);
  }
  return readBalance(res);
}

/**
 * Call before every PAID pull. Returns false when the account is under
 * ODDS_CBB_FLOOR credits (skip the pull). If the stored reading looks low it
 * re-checks for free first, so a rotated key or a new month can't get stuck
 * behind an old low reading (the CFB key hit exactly that in Sept 2026).
 */
export async function oddsCbbFloorCheck(prisma: PrismaClient): Promise<boolean> {
  const ym = new Date().toISOString().slice(0, 7);
  const prior = await prisma.apiUsage.findUnique({
    where: { api_yearMonth: { api: "odds_cbb", yearMonth: ym } },
  });
  if (prior?.lastRemaining == null || prior.lastRemaining >= ODDS_CBB_FLOOR) return true;
  const fresh = await checkOddsCbbBalance();
  await recordOddsCbbUsage(prisma, fresh);
  return fresh.remaining == null || fresh.remaining >= ODDS_CBB_FLOOR;
}

export interface OddsCbbResult extends OddsBalance {
  events: OddsEvent[];
}

/** Pull the current NCAAB board from FanDuel. Default: moneyline + spread (2 credits). */
export async function fetchNcaabOdds(
  markets: string[] = ["h2h", "spreads"]
): Promise<OddsCbbResult> {
  const key = requireOddsCbbKey();
  const url =
    `${ODDS_BASE}/sports/${CBB_SPORT_KEY}/odds` +
    `?apiKey=${key}&bookmakers=fanduel&markets=${markets.join(",")}&oddsFormat=american`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Odds API (CBB) -> ${res.status} ${res.statusText} ${await res.text()}`);
  }
  return { events: (await res.json()) as OddsEvent[], ...readBalance(res) };
}
