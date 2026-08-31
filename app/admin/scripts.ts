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
};
