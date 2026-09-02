// ============================================================
// Turn many sportsbooks' Line rows into one consensus number
// ============================================================

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The single line the most sportsbooks are actually posting — i.e. a number you
 * could really bet, unlike the median which can land between books (e.g. a
 * median total of 58.3). Ties break toward the value nearest `pull` (the
 * median), then toward the lower number.
 */
export function modalLine(values: number[], pull: number): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  let best = values[0];
  let bestN = -1;
  let bestDist = Infinity;
  for (const [v, n] of counts) {
    const dist = Math.abs(v - pull);
    if (
      n > bestN ||
      (n === bestN && dist < bestDist) ||
      (n === bestN && dist === bestDist && v < best)
    ) {
      best = v;
      bestN = n;
      bestDist = dist;
    }
  }
  return best;
}

export interface LineRow {
  gameId: string;
  market: string; // 'spread' | 'total'
  lineValue: number;
  sportsbook: string;
  snapshotType: string;
  capturedAt: Date;
}

/**
 * For each game, the consensus (median across books) spread and total,
 * using only the most recent snapshot captured for that game.
 * Spread is the home-team spread (negative = home favored), matching how
 * pullLines.ts stores it.
 */
export interface Consensus {
  spread: number | null; // median home spread across books (may be inter-book, e.g. -6.3)
  total: number | null; // median total across books
  spreadBook: number | null; // most-posted real home spread — a number you can actually bet
  totalBook: number | null; // most-posted real total
  books: number;
  capturedAt: Date | null;
}

export function consensusByGame(lines: LineRow[]): Map<string, Consensus> {
  const byGame = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = byGame.get(l.gameId);
    if (arr) arr.push(l);
    else byGame.set(l.gameId, [l]);
  }

  const out = new Map<string, Consensus>();

  for (const [gameId, rows] of byGame) {
    const latest = rows.reduce(
      (max, r) => (r.capturedAt > max ? r.capturedAt : max),
      rows[0].capturedAt
    );
    // "same snapshot" = captured within 90 min of the latest row (one pull run)
    const window = 90 * 60 * 1000;
    const fresh = rows.filter((r) => latest.getTime() - r.capturedAt.getTime() <= window);

    const spreads = fresh.filter((r) => r.market === "spread").map((r) => r.lineValue);
    const totals = fresh.filter((r) => r.market === "total").map((r) => r.lineValue);

    const spread = median(spreads);
    const total = median(totals);

    out.set(gameId, {
      spread,
      total,
      spreadBook: spread == null ? null : modalLine(spreads, spread),
      totalBook: total == null ? null : modalLine(totals, total),
      books: new Set(fresh.map((r) => r.sportsbook)).size,
      capturedAt: latest,
    });
  }

  return out;
}
