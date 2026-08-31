// ============================================================
// Kalshi public API — NCAA football game markets
// ============================================================
// Free, no auth for public market reads. CFTC-regulated exchange, so
// reading the public API is unambiguously fine.
//
// Series KXNCAAFGAME: one event per game, two binary markets per event
// ("Team A wins" / "Team B wins"). last_price = implied win probability.
// ============================================================

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES = "KXNCAAFGAME";

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  status: string; // 'active' | 'closed' | ...
  yes_sub_title: string; // the team this "yes" is for, e.g. "Ohio State Buckeyes"
  last_price_dollars: string; // "0.62"
  previous_price_dollars: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  volume_fp: string; // contracts traded (≈ $ notional)
  volume_24h_fp: string;
  open_interest_fp: string;
  close_time: string;
}

export interface KalshiEvent {
  event_ticker: string;
  title: string; // "Michigan St. vs Notre Dame"
  sub_title: string; // "MSU vs ND (Sep 19)"
}

async function getAll<T>(
  path: string,
  key: "markets" | "events"
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}limit=200${
      cursor ? `&cursor=${cursor}` : ""
    }`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Kalshi ${path} -> ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    out.push(...((j[key] as T[]) ?? []));
    cursor = (j.cursor as string) || undefined;
    if (!cursor) break;
  }
  return out;
}

export async function fetchNcaafEvents(): Promise<KalshiEvent[]> {
  return getAll<KalshiEvent>(`/events?series_ticker=${SERIES}`, "events");
}

export async function fetchNcaafMarkets(): Promise<KalshiMarket[]> {
  const all = await getAll<KalshiMarket>(
    `/markets?series_ticker=${SERIES}`,
    "markets"
  );
  return all.filter((m) => m.status === "active" || m.status === "open");
}

const num = (s: string | null | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export interface KalshiGameMarket {
  eventTicker: string;
  teamA: string; // yes_sub_title of market A
  teamB: string;
  probA: number; // de-vigged win prob for team A
  probB: number;
  prevProbA: number | null;
  volume: number; // event volume (sum of both sides' contracts)
  volume24h: number;
  openInterest: number;
  closeTime: string;
}

/** collapse the two markets per event into one de-vigged game view */
export function groupByEvent(markets: KalshiMarket[]): KalshiGameMarket[] {
  const byEvent = new Map<string, KalshiMarket[]>();
  for (const m of markets) {
    const arr = byEvent.get(m.event_ticker) ?? [];
    arr.push(m);
    byEvent.set(m.event_ticker, arr);
  }
  const out: KalshiGameMarket[] = [];
  for (const [eventTicker, ms] of byEvent) {
    if (ms.length !== 2) continue;
    const [a, b] = ms;
    const rawA = num(a.last_price_dollars);
    const rawB = num(b.last_price_dollars);
    const sum = rawA + rawB;
    if (sum <= 0) continue;
    const prevA = num(a.previous_price_dollars);
    const prevB = num(b.previous_price_dollars);
    const prevSum = prevA + prevB;
    out.push({
      eventTicker,
      teamA: a.yes_sub_title,
      teamB: b.yes_sub_title,
      probA: rawA / sum,
      probB: rawB / sum,
      prevProbA: prevSum > 0 ? prevA / prevSum : null,
      volume: num(a.volume_fp) + num(b.volume_fp),
      volume24h: num(a.volume_24h_fp) + num(b.volume_24h_fp),
      openInterest: num(a.open_interest_fp) + num(b.open_interest_fp),
      closeTime: a.close_time,
    });
  }
  return out;
}
