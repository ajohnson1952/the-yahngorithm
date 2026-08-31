// ============================================================
// Model configuration — the tunable knobs, all in one place
// ============================================================
// These start at the brief's suggested values. Once we have a few
// weeks of graded results we tune them against history (that's a
// deliberate later step — don't hand-tweak mid-season without
// writing down why in docs/INTERPRETATION_GUIDE.md).
// ============================================================

/**
 * Home-field advantage, in points, added to the home team's predicted
 * margin. Brief says ~2–3. Neutral-site games get 0 (see Game.neutralSite).
 */
export const HOME_FIELD_ADVANTAGE = 2.5;

/**
 * A spread disagreement smaller than this is noise — never a pick candidate.
 * Brief: ~2.5+ points, AND a second independent signal must corroborate.
 */
export const SPREAD_EDGE_THRESHOLD = 2.5;

/**
 * If SP+ and SRS predicted margins are more than this far apart, the two
 * models disagree — lower confidence, treat SRS gap as a caution flag.
 * (Only meaningful once SRS has data, ~week 3+.)
 */
export const MODEL_DISAGREEMENT_POINTS = 3.0;

// --- Totals model ---------------------------------------------------------

/** League-average possessions per team per game (2025 baseline, ~23 total). */
export const LEAGUE_AVG_POSSESSIONS_PER_TEAM = 11.6;

/**
 * Wind (mph, sustained) at or above this starts pushing the total down;
 * below it, wind is ignored. See docs/INTERPRETATION_GUIDE.md §3–4.
 */
export const WIND_UNDER_THRESHOLD = 12;
/** Points shaved off the total per mph of wind above the threshold (capped). */
export const WIND_UNDER_PER_MPH = 0.45;
export const WIND_UNDER_MAX = 9;

/** A totals disagreement smaller than this is noise. Totals are noisier than
 *  spreads, so this is higher than SPREAD_EDGE_THRESHOLD. */
export const TOTAL_EDGE_THRESHOLD = 3.5;

// --- Pick generation -----------------------------------------------------

/**
 * Skip spread edges when the market spread is bigger than this — books shade
 * big favorites and the model's edge there is an artifact (GUIDE §2).
 */
export const LARGE_SPREAD_CAP = 20;

/** Totals edges only count on competitive games (market spread within this). */
export const TOTALS_COMPETITIVE_CAP = 14;

/** predictedPossessions at/below this = a genuinely slow game (UNDER lean). */
export const SLOW_GAME_POSSESSIONS = 21;
/** ...at/above this = a genuinely fast game (OVER lean). */
export const FAST_GAME_POSSESSIONS = 26;
/** Sustained wind (mph) that corroborates an UNDER. */
export const WIND_UNDER_CORROBORATION = 15;
