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

export interface KalshiSide {
  team: string;
  yesPrice: number; // raw "yes" last price (0..1)
  bid: number | null;
  ask: number | null;
  volume: number; // contracts (~$1 each)
  volume24h: number;
  openInterest: number;
}

export interface KalshiGameMarket {
  eventTicker: string;
  a: KalshiSide;
  b: KalshiSide;
  probA: number; // de-vigged win prob for side A
  probB: number;
  prevProbA: number | null;
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
  const side = (m: KalshiMarket): KalshiSide => ({
    team: m.yes_sub_title,
    yesPrice: num(m.last_price_dollars),
    bid: m.yes_bid_dollars ? num(m.yes_bid_dollars) : null,
    ask: m.yes_ask_dollars ? num(m.yes_ask_dollars) : null,
    volume: num(m.volume_fp),
    volume24h: num(m.volume_24h_fp),
    openInterest: num(m.open_interest_fp),
  });
  const out: KalshiGameMarket[] = [];
  for (const [eventTicker, ms] of byEvent) {
    if (ms.length !== 2) continue;
    const [a, b] = [side(ms[0]), side(ms[1])];
    const sum = a.yesPrice + b.yesPrice;
    if (sum <= 0) continue;
    const prevA = num(ms[0].previous_price_dollars);
    const prevB = num(ms[1].previous_price_dollars);
    const prevSum = prevA + prevB;
    out.push({
      eventTicker,
      a,
      b,
      probA: a.yesPrice / sum,
      probB: b.yesPrice / sum,
      prevProbA: prevSum > 0 ? prevA / prevSum : null,
      closeTime: ms[0].close_time,
    });
  }
  return out;
}
