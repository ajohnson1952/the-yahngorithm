# the yahngorithm

A college-football analytics tool: it runs several power-rating models against the
sportsbook lines, layers on situational and market signals, and surfaces the games
where our numbers and the market disagree. Decision support — not a money-printer.
(Separate project from Cavepicks.)

**Live:** https://the-yahngorithm.onrender.com

---

## What it does

### Three spread models (all on the same "points better than average" scale)

| Model | Source | Idea |
|---|---|---|
| **SP+** | CFBD `/ratings/sp`, extended to FCS with Bill Connelly's 772-team sheet | opponent-adjusted play-by-play efficiency — the predictive one, drives pick generation |
| **SRS** | CFBD `/ratings/srs` | opponent-adjusted scoring margin — empty until ~week 3 |
| **Yahn** | SP+ backbone + EPA + roster factors (talent / returning production / transfer portal) + per-team home-field | a stat composite shown as a third opinion — **backtested to no ATS edge, so it does not feed picks** (see `docs/CALIBRATION.md`) |

`predicted_margin = home_rating − away_rating + home_field_advantage`

### Totals model

SP+ offense/defense → points per possession → scaled by projected pace, minus a
wind adjustment. SP+ only (SRS has no O/D split).

### Signals layered on top

- **Situational flags** — `short_week`, `off_bye`, `travel`, `revenge`, `lookahead`,
  `letdown` (schedule-derived, conservative thresholds).
- **Market flags** — `steam` (fast synchronized line move) and `rlm` (book moved
  toward a team while the Kalshi prediction market moved the other way, on real
  volume).
- **Team trends** — current-season ATS / straight-up / over-under splits, with
  outliers (≥65% or ≤35% on 8+ games) flagged.
- **Prediction market** — Kalshi win probabilities per game as an independent,
  no-vig "fair value" reference, snapshotted over time.

A **pick** is logged only when the edge clears a threshold *and* a second
independent signal agrees. Every pick is frozen at its logged line and graded
later on ATS and CLV. See [`docs/INTERPRETATION_GUIDE.md`](docs/INTERPRETATION_GUIDE.md)
for how to read any of this.

---

## Data sources & free-tier budget

| Source | Auth | Limit | Our monthly use |
|---|---|---|---|
| CollegeFootballData | Bearer key | ~1,000 calls/mo | ~8% |
| The Odds API | key | 500 credits/mo (2 per line pull) | ~34% with hourly gameday pulls |
| Kalshi | none (public reads) | none | — |
| Open-Meteo | none | fair use | negligible |
| ESPN (unofficial) | none | none published | fine |

---

## Pipeline

Standalone scripts in `scripts/`, each an npm script:

| Command | What |
|---|---|
| `pull-ratings` | SP+ / SRS / pace → `TeamRatingWeekly` |
| `load-billc` | Bill C's sheet (`data/billc/latest.csv`) → FCS SP+, re-centered |
| `pull-rankings` | AP + Coaches polls |
| `pull-games` | schedule + scores + venue + TV |
| `pull-lines` | The Odds API line snapshots (`--type open\|daily\|close`) |
| `pull-historical-lines` | CFBD `/lines` backfill for past seasons |
| `pull-kalshi` | Kalshi win-probability snapshots |
| `pull-weather` / `pull-injuries` | Open-Meteo / ESPN |
| `compute-flags` | situational flags |
| `compute-market-flags` | steam / rlm |
| `run-model` | write `ModelPrediction` rows |
| `generate-picks` | create `Pick` rows when the bar is met |
| `grade-picks` | ATS + CLV once games are final |
| `compute-trends` | team ATS/SU/O-U splits |
| `seed-rivalries` | load `data/rivalries.ts` |

### Schedule (GitHub Actions, `.github/workflows/`)

- **Tue** — ratings, rankings, games, opening lines, flags, model, picks
- **Thu–Sat, hourly** — line + Kalshi snapshots, market flags, re-run model/picks
- **Sun** — final scores, grade picks, refresh trends
- **Daily** — weather + injuries

Scheduled workflows run **only from the default branch** and need three repo
secrets: `DATABASE_URL`, `CFBD_API_KEY`, `ODDS_API_KEY`. The `/admin` page
(password-gated) can also trigger any script on demand.

---

## Webapp (Next.js 16, App Router)

| Route | |
|---|---|
| `/` | the week's board — grouped by edge, or toggle to kickoff order; page between weeks |
| `/game/[id]` | full breakdown: three spread models, totals math, flags, line movement, Kalshi panel, weather, injuries, trends, picks |
| `/picks` | season pick log with ATS record + CLV |
| `/rankings` | "My Top 25" drag-and-drop editor (password `2142`) — a reference list; does not feed the model |
| `/admin` | manual pipeline runs (password `2142`) |
| `/guide` | renders the interpretation guide |

---

## Local development

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, CFBD_API_KEY, ODDS_API_KEY
npx prisma migrate deploy
npm run dev                  # http://localhost:3000
```

Migrations use the diff + `migrate deploy` flow (not `migrate dev`) because
`migrate dev` hard-fails in a non-interactive shell on warning prompts.

## Deployment

Render web service (`render.yaml`), auto-deploys `main`. Build runs
`prisma migrate deploy` so schema changes ship with the code. Render env needs
`DATABASE_URL`, `CFBD_API_KEY`, `ODDS_API_KEY`.

## Layout

```
app/            Next.js routes + components
components/     shared UI (GameCard, ui.tsx, Nav)
lib/            data layer + model helpers (webData, cfbd, kalshi, yahn, winProb, …)
scripts/        the pipeline
prisma/         schema + migrations
data/           rivalries, Bill C sheet
docs/           see below
.github/        scheduled workflows
```

## Docs

| | |
|---|---|
| [`docs/INTERPRETATION_GUIDE.md`](docs/INTERPRETATION_GUIDE.md) | what every number on the site means and how much to trust it (rendered at `/guide`) |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | how it runs during the season — the automatic schedule, your weekly rhythm, what to do if something breaks |
| [`docs/CALIBRATION.md`](docs/CALIBRATION.md) | the backtest findings — **no proven ATS edge**; what got built to test it and how to reproduce |
| [`docs/STATUS.md`](docs/STATUS.md) | current-state snapshot + backlog |
