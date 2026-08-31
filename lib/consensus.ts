// ============================================================
// Turn many sportsbooks' Line rows into one consensus number
// ============================================================

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
export function consensusByGame(lines: LineRow[]): Map<
  string,
  { spread: number | null; total: number | null; books: number; capturedAt: Date | null }
> {
  const byGame = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = byGame.get(l.gameId);
    if (arr) arr.push(l);
    else byGame.set(l.gameId, [l]);
  }

  const out = new Map<
    string,
    { spread: number | null; total: number | null; books: number; capturedAt: Date | null }
  >();

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

    out.set(gameId, {
      spread: median(spreads),
      total: median(totals),
      books: new Set(fresh.map((r) => r.sportsbook)).size,
      capturedAt: latest,
    });
  }

  return out;
}
