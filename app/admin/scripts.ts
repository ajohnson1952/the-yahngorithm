// scripts the admin panel is allowed to trigger (fast / safe ones only).
// Plain module — not "use server" — so it can export data.

export const RUNNABLE: Record<
  string,
  { file: string; args?: string[]; label: string; note: string }
> = {
  "pull-ratings": {
    file: "scripts/pullRatings.ts",
    label: "Pull ratings (SP+ / SRS / pace)",
    note: "CFBD — ~3 calls of 1,000/mo. Tuesdays.",
  },
  "pull-rankings": {
    file: "scripts/pullRankings.ts",
    label: "Pull polls (AP / Coaches)",
    note: "CFBD — 1 call. Sundays.",
  },
  "pull-games": {
    file: "scripts/pullGames.ts",
    label: "Pull games (scores + schedule, this week)",
    note: "CFBD — ~3 calls. Run Sun for scores.",
  },
  "pull-lines-daily": {
    file: "scripts/pullLines.ts",
    args: ["--type", "daily"],
    label: "Pull betting lines (daily snapshot)",
    note: "The Odds API — 2 credits of 500/mo. Wed–Sat.",
  },
  "pull-weather": {
    file: "scripts/pullWeather.ts",
    label: "Pull weather",
    note: "Open-Meteo — free, no key. Inside 16 days only.",
  },
  "pull-injuries": {
    file: "scripts/pullInjuries.ts",
    label: "Pull injuries",
    note: "ESPN unofficial — no published limit. Feed is thin.",
  },
  "pull-kalshi": {
    file: "scripts/pullKalshi.ts",
    label: "Pull prediction markets (Kalshi)",
    note: "Kalshi public API — free, no auth. ~2 calls.",
  },
  "compute-flags": {
    file: "scripts/computeFlags.ts",
    label: "Recompute situational flags",
    note: "No API. After ratings / games.",
  },
  "compute-market-flags": {
    file: "scripts/computeMarketFlags.ts",
    label: "Recompute market flags (RLM / steam)",
    note: "No API. After pull-lines + pull-kalshi.",
  },
  "run-model": {
    file: "scripts/runModel.ts",
    label: "Run the model (spreads + totals)",
    note: "No API. After ratings / lines.",
  },
  "generate-picks": {
    file: "scripts/generatePicks.ts",
    label: "Generate picks",
    note: "No API. After run-model + compute-flags.",
  },
  "grade-picks": {
    file: "scripts/gradePicks.ts",
    label: "Grade picks",
    note: "CFBD — a few calls. After scores are in.",
  },
  "compute-trends": {
    file: "scripts/computeTeamTrends.ts",
    label: "Recompute team trends (ATS / SU / O-U)",
    note: "No API. Sundays after grade-picks.",
  },

  // --- Yahn model v2 factor feeds ---
  "pull-talent": {
    file: "scripts/pullTalent.ts",
    label: "Pull team talent composite (247)",
    note: "CFBD — 1 call. Preseason; static through the year.",
  },
  "pull-returning": {
    file: "scripts/pullReturning.ts",
    label: "Pull returning production",
    note: "CFBD — 1 call. Preseason roster stability score.",
  },
  "pull-portal": {
    file: "scripts/pullPortal.ts",
    label: "Pull transfer portal + net rollup",
    note: "CFBD — 1 call. Refresh through the portal windows.",
  },
  "pull-advanced": {
    file: "scripts/pullAdvanced.ts",
    label: "Pull advanced stats + EPA (weekly)",
    note: "CFBD — 2 calls. After games each week.",
  },
  "compute-team-hfa": {
    file: "scripts/computeTeamHfa.ts",
    label: "Recompute per-team home-field advantage",
    note: "CFBD — ~3 calls (historical SP+). Rare; run once a year.",
  },
};

// "Run everything" chain — the full weekly pipeline in dependency order, minus
// the annual factor feeds (talent / returning / portal / hfa). The admin panel
// fires these one at a time, in order, stopping the run if a step fails.
// ~10–15 CFBD calls + 2 Odds credits total.
export const RUN_ALL_ORDER: string[] = [
  "pull-ratings",
  "pull-rankings",
  "pull-games",
  "pull-advanced",
  "pull-lines-daily",
  "pull-kalshi",
  "pull-weather",
  "pull-injuries",
  "compute-flags",
  "compute-market-flags",
  "run-model",
  "generate-picks",
  "grade-picks",
  "compute-trends",
];
