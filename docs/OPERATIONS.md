# Operating the-yahngorithm during the season

Everything below runs **automatically** on GitHub Actions. You only touch
`/admin` (password `2142`, or whatever `ADMIN_PASSWORD` is set to) if a
scheduled run failed or you want a fresh pull right now.

## The automatic schedule

| Workflow | When (UTC) | What it does |
|---|---|---|
| **Tue weekly** | Tue 14:00 | ratings (SP+ / SRS / pace), polls, this week's schedule, advanced stats + EPA, **opening lines**, Kalshi, situational flags, market flags, run model, generate picks |
| **Gameday** | Thu 20/23, Fri 18/21/23, Sat 15–23 + Sun 00–04 | **line snapshots** (this is what makes `steam` work), Kalshi, market flags, re-run model, re-generate picks |
| **Sun results** | Sun 16:00 | final scores, advanced stats, **grade the week's picks** (ATS + CLV), refresh team trends, market flags, run model |
| **Daily** | every day 13:00 | weather forecast, injury report |
| **Preseason factor refresh** | manual only | talent composite, returning production, transfer portal, per-team HFA — run once preseason and again after the portal windows |

Budget with this schedule: CFBD ~15%/mo, The Odds API ~35%/mo. Comfortable.

## Your weekly rhythm

1. **Tuesday/Wednesday** — the board has opening lines + the model + any picks.
   Skim it. Check `/picks` for last week's grade.
2. **Through the week** — watch the board as lines move. The **"Bad spots"**
   filter surfaces the 1–2 nastiest situational spots. Read the game pages for
   the ones you care about — that's where the flags, trends, Kalshi panel, line
   movement, and the Yahn breakdown all live.
3. **Saturday** — final line check before kickoff.
4. **Sunday** — `Sun results` grades everything overnight; look at CLV, not W-L.

## What to actually trust

Per the backtests (`docs/CALIBRATION.md`), **nothing here has a proven ATS edge
over the closing line.** Use it as decision support:

- **The market line is the best single number.** Start there.
- **Yahn / SP+ / SRS** — a third, fourth, fifth opinion and a *why*. Big
  disagreement = a reason to look closer, not a bet.
- **`travel` and `bad_spot`** are the flags with the most (still weak) signal —
  worth a lean toward the other side.
- **`short_week`, `off_bye`, and line movement at the close** — ignore as bet
  triggers (backtested at/below 50%).
- **CLV over time** is the only honest scoreboard for whether the process works.

## If something breaks

- **A workflow failed** (GitHub → Actions, red X) — open it, read the step log.
  Usually a transient CFBD/Odds 5xx; just re-run the job.
- **The board looks stale** — hit the relevant button on `/admin` (each is one
  pipeline step; the page lists API cost per button).
- **Repo secrets missing** — `DATABASE_URL`, `CFBD_API_KEY`, `ODDS_API_KEY` in
  GitHub → Settings → Secrets → Actions. Without them every workflow no-ops.
- **`/admin` buttons fail in prod** — `CFBD_API_KEY` / `ODDS_API_KEY` also need
  to be in the Render service env.

## Grading the models live (backlog)

`grade-picks` currently only grades logged `Pick` rows. To get a hindsight-free
read on the three spread models and each flag over the 2026 season, extend it
to also score `predictedSpreadSpPlus` / `predictedSpreadSrs` /
`predictedSpreadYahn` and every `GameFlag` against the closing line each week.
By ~week 8 that's the real answer to "does any of this beat the market."
