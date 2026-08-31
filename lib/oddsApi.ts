// ============================================================
// The Odds API helper
// ============================================================
// Dedicated key for THIS project (separate account from Cavepicks —
// the free tier's monthly credits are per-account). Loaded from .env.
// Cost model: 1 credit per market per region per call. So a
// spreads+totals US call costs 2 credits. Budget is 500/month.
// ============================================================

const ODDS_BASE = "https://api.the-odds-api.com/v4";

export function requireOddsKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    console.error(
      "Missing ODDS_API_KEY. Add it to .env (a NEW the-odds-api.com account, " +
        "not the Cavepicks one). Stopping."
    );
    process.exit(1);
  }
  return key;
}

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}
export interface OddsMarket {
  key: string; // 'spreads' | 'totals' | 'h2h'
  last_update: string;
  outcomes: OddsOutcome[];
}
export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}
export interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface OddsResult {
  events: OddsEvent[];
  creditsRemaining: number | null;
  creditsLastCost: number | null;
}

/** Pull the current NCAAF board for the given markets (default spreads+totals). */
export async function fetchNcaafOdds(
  markets: string[] = ["spreads", "totals"]
): Promise<OddsResult> {
  const key = requireOddsKey();
  const url =
    `${ODDS_BASE}/sports/americanfootball_ncaaf/odds` +
    `?apiKey=${key}&regions=us&markets=${markets.join(",")}&oddsFormat=american`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Odds API -> ${res.status} ${res.statusText} ${await res.text()}`);
  }
  const num = (h: string) => {
    const v = res.headers.get(h);
    return v == null ? null : Number(v);
  };
  return {
    events: (await res.json()) as OddsEvent[],
    creditsRemaining: num("x-requests-remaining"),
    creditsLastCost: num("x-requests-last"),
  };
}
