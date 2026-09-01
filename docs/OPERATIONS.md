# Operating the-yahngorithm during the season

Everything below runs **automatically** on GitHub Actions. You only touch
`/admin` (password `2142`, or whatever `ADMIN_PASSWORD` is set to) if a
scheduled run failed or you want a fresh pull right now.

## The automatic schedule

| Workflow | When (UTC) | What it does |
|---|---|---|
| **Heartbeat** | every 3 h, all week | Kalshi refresh, market flags, re-run model, re-generate picks (all free) |
| **Betting lines** | Wed 21; Thu 16/22; Fri 16/22; Sat every 2 h 13–23; Sat-night + Sun 01/15/20; Mon 19/22 | scores, **line snapshots** (feeds `steam`), market flags, model, picks — covers every day games are played, including Sun/Mon |
| **Tue weekly** | Tue 14:13 | grade last week, then ratings (SP+ / SRS / pace), polls, schedule, advanced stats + EPA, **opening lines**, Kalshi, situational flags, model, picks |
| **Sun results** | Sun 15:43 | Saturday's finals, advanced-stat checkpoint, **grade** (picks + all models + all flags vs the close → Grades page), team trends |
| **Daily** | 11:43 and 23:43 | weather forecast, injury report |
| **Preseason factor refresh** | manual only | talent composite, returning production, transfer portal, per-team HFA — run once preseason and again after the portal windows |

Budget with this schedule: CFBD ~35%/mo, The Odds API ~30%/mo. Comfortable.

> **If the data looks stale:** check **GitHub → Actions**. Scheduled workflows
> sometimes don't start until the workflow files have been re-pushed (any commit
> touching `.github/workflows/`). If a manual **Run workflow** succeeds but the
> schedules stay dead for a day, the workflow files need another push, or the
> repo secrets (`DATABASE_URL`, `CFBD_API_KEY`, `ODDS_API_KEY` — under Settings →
> Secrets and variables → **Actions**) are missing.

## Your weekly rhythm

1. **Tuesday/Wednesday** — the board has opening lines + the model + any picks.
   Skim it. Check `/grades` + `/picks` for last week.
2. **Through the week** — Kalshi + the model refresh every 3 hours; lines refresh
   every game day. Watch the board as lines move. The **"Bad spots"** filter
   surfaces the 1–2 nastiest situational spots; **pin** games you're tracking.
   Read the game pages — flags, trends, Kalshi panel, line movement, the current
   sportsbook lines, and the Yahn breakdown all live there.
3. **Saturday** — final line check before kickoff (game pages show every book's
   current number).
4. **Sunday/Monday** — grading runs Sunday and again Tuesday (to catch Sun/Mon
   games). Check `/grades` for how each model + flag is tracking for the season,
   and `/picks` for CLV (not W-L).

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

## The Grades page

`grade-picks` (Sunday) now scores **all three spread models and every flag**
against the closing line on each final game, frozen at first grading, into
`ModelGrade`. The **Grades** page is the season-to-date scoreboard: ATS record
and win % for each model (overall + on edge ≥ 2) and each flag, vs the 52.4%
break-even.

Small samples early — one week is noise. The point is the trend by ~week 8:
if SP+ / Yahn / a flag is sitting at 50% on 100+ games, that's the honest
verdict. The backtests say to expect exactly that.
