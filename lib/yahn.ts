// ============================================================
// Yahn eye-test ranking -> point-spread rating
// ============================================================
// You rank your top 25; the list is split into tiers. Every team in a
// tier gets that tier's rating — the average of the SP+ ratings that
// normally sit in that rank range. Order *within* a tier doesn't change
// the number (that's the point: "these are all elite, exact order fuzzy").
// Unranked teams keep their real SP+ number.
//
//   yahn_spread = home_yahn - away_yahn + HFA   (3rd model, SP+ scale)
// ============================================================

export interface YahnTier {
  name: string;
  from: number; // inclusive rank
  to: number; // inclusive rank
}

// fixed bands for now — can be made draggable later
export const YAHN_TIERS: YahnTier[] = [
  { name: "Tier 1", from: 1, to: 4 },
  { name: "Tier 2", from: 5, to: 10 },
  { name: "Tier 3", from: 11, to: 16 },
  { name: "Tier 4", from: 17, to: 25 },
];

export const YAHN_MAX_RANK = 25;

export function tierOf(rank: number): YahnTier | null {
  return YAHN_TIERS.find((t) => rank >= t.from && rank <= t.to) ?? null;
}

/**
 * Given every FBS team's SP+ overall rating, the rating each tier confers:
 * the mean of the SP+ ratings that fall in that tier's rank window.
 */
export function tierRatings(spPlusOverall: number[]): Map<string, number> {
  const sorted = [...spPlusOverall].sort((a, b) => b - a);
  const out = new Map<string, number>();
  for (const t of YAHN_TIERS) {
    const slice = sorted.slice(t.from - 1, t.to);
    const mean = slice.length
      ? slice.reduce((a, b) => a + b, 0) / slice.length
      : 0;
    out.set(t.name, Math.round(mean * 10) / 10);
  }
  return out;
}

/**
 * yahn rating for one team.
 * @param rank      the team's Yahn rank (1..25) or null if unranked
 * @param spPlus    the team's own SP+ overall (used when unranked)
 * @param tierRates output of tierRatings()
 */
export function yahnRating(
  rank: number | null,
  spPlus: number | null,
  tierRates: Map<string, number>
): number | null {
  if (rank != null) {
    const t = tierOf(rank);
    if (t) return tierRates.get(t.name) ?? null;
  }
  return spPlus;
}
