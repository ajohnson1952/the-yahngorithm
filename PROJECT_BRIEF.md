# Project Brief — CFB Betting Model

Read this first for context before making changes. This project is separate from
"Cavepicks" (a different pick'em app the same person is building), though it reuses
some lessons learned there.

## What this is

A college football analytics tool. It builds a power-rating-based prediction model
(spreads and totals) and compares it against real sportsbook lines to surface games
where the model and the market disagree — i.e., games worth a closer look. It's built
as **decision support**, not a system that promises guaranteed betting edges — betting
markets are efficient, so the honest framing is "here's where my model and the market
disagree, and here's my track record when that's happened," logged and graded over
time.

## Current status

> **This section is the original kickoff brief — kept for intent/context.**
> For where the project actually stands now (fully built and deployed, in
> "watch football and grade live" mode), see **`docs/STATUS.md`** and
> **`README.md`**.

_Original:_ The database schema (`prisma/schema.prisma`) and the
team-name-matching logic are built; nothing else is yet. The person is a coding
novice — explain steps clearly and confirm before running anything that touches
real API keys or the database.

## Build order — please follow this sequence, don't skip ahead

1. **Get the project running end-to-end first**: help the person set up a Neon
   Postgres database, get free API keys (CollegeFootballData, and a DEDICATED Odds
   API key — separate from the one used in their other project, Cavepicks, since
   free-tier credits are shared per account), fill in `.env`, run
   `npx prisma migrate dev`, and run `npm run match-aliases`.
2. **Review the alias-matching results together** before building anything else.
   Team identity underpins every other table (games, lines, weather, injuries all
   reference `team_id`, never a raw name string) — getting this wrong caused real,
   hard-to-find bugs in the Cavepicks project (e.g. a naive "Louisiana" substring
   match incorrectly firing on "Louisiana Tech Bulldogs"). Any alias flagged
   `needs_review` should be resolved by hand, not auto-guessed.
3. Only after that: build out the rest of the pipeline (below).

## Data sources (all already decided — don't re-evaluate alternatives)

| Data | Source | Notes |
|---|---|---|
| Power ratings (SP+), efficiency stats, schedule, historical lines/ATS | **CollegeFootballData API (CFBD)** | Free tier: 1,000 calls/month. Treat as source of truth for canonical team names. |
| Live/current sportsbook lines, line movement | **The Odds API** | Free tier: 500 credits/month, cost = markets × regions per call. Use a dedicated key for this project. |
| Weather | **Open-Meteo** | Free, no key needed. Pull close to kickoff for accuracy. |
| Injuries | **ESPN's unofficial API** | Filter to starters/impact players only (QB, RB1, WR1, key defensive playmakers) — bench injuries are noise and shouldn't be tracked. |
| Rivalries | Manual seed table (`Rivalry` model) | ~40-50 FBS rivalry pairs, hand-curated, not derivable from an API. |

## Weekly data pull cadence (matches how the underlying data actually updates)

- **Sunday evening**: pull final scores/box scores from CFBD for the weekend just played.
- **Tuesday morning**: pull refreshed SP+ ratings from CFBD (this is when the weekly
  rating update actually publishes — don't pull Monday, it'll be stale).
- **Tuesday (later)**: pull opening lines from The Odds API for the upcoming week
  (full slates are typically posted by Sunday evening, so they should be up by now) —
  this is the first model-vs-market comparison of the week.
- **Wednesday–Friday**: one Odds API line check per day (tracks movement without
  burning through the monthly credit budget).
- **Saturday morning**: pull closing lines, latest ESPN injury report, and Open-Meteo
  weather forecast — the final look before kickoff.

## The model, once built

**Spread model:**
```
predicted_margin = (home_team_SP+ - away_team_SP+) + home_field_advantage
```
(home_field_advantage ~2-3 points, tune against historical data later)
Compare `predicted_margin` to the market spread → `edge`. Only surface as a "pick"
candidate if edge clears a meaningful threshold (~2.5+ points) AND a second, independent
signal corroborates it (see situational flags below) — a lone model disagreement isn't
enough on its own.

**Totals model:**
Convert offensive/defensive ratings to points-per-possession, scale by expected game
pace (possessions), sum both teams' expected points. Weather (wind especially) and
pace mismatches matter more here than for spreads. Expect this model to be noisier
than the spread model — weight confidence accordingly.

**Situational flags** (stored in `GameFlag`, corroborating signals, not the primary
prediction):
- `lookahead` — team is a big favorite this week but faces a much tougher/rivalry
  opponent next week
- `letdown` — team just had a big emotional win last week, faces an easier opponent now
- `short_week` — less than 6 days since last game
- `off_bye` — more than 10 days since last game
- `travel` — long distance and/or timezone change from home
- `revenge` — lost to this exact opponent last time they played

**Every pull is a snapshot, never an overwrite** — `Line`, `Weather`, and
`ModelPrediction` all timestamp each pull rather than updating in place. This is what
makes closing-line-value (CLV) math and honest grading of past picks possible later.

## Track record matters more than any single prediction

Every suggested pick gets logged in the `Pick` table with the model line, market line,
and edge at the time — and graded after the game against both the final score and the
closing line. The point of this project is to find out, over a season, whether the
signal is real — not to generate confident-sounding picks with no accountability.
