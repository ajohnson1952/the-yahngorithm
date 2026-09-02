# Operating the-yahngorithm during the season

Everything below runs **automatically**. You only touch `/admin` (password
`2142`, or whatever `ADMIN_PASSWORD` is set to) if something failed or you want
a fresh pull right now.

## How scheduling works

GitHub's own `schedule` trigger was firing 2–3 hours late on this repo, so we
don't use it. Instead:

- **cron-job.org** hits the GitHub API every ~30 minutes and fires the
  **`Tick — scheduler`** workflow (`workflow_dispatch`).
- **`scripts/tick.ts`** is the brain: it reads the wall clock (US Central) and
  how stale each data source is, then runs exactly the npm scripts that are due.
  All schedule logic is in that one file.

| Group | Fires | What runs |
|---|---|---|
| **heartbeat** | every tick (~30 min) | Kalshi, market flags, model, picks — all free |
| **scores** | game windows (all week except Tue daytime) | `pull-games` + `grade-picks` — ~30 min on Saturday, ~hourly otherwise. A final is graded within ~30 min |
| **lines** | game windows, never Tuesday | `pull-lines --daily` — every ~30 min in the Sat 9a–8p core, every ~2.75 h otherwise. Also self-limits when monthly Odds credits run low |
| **weekly** | Tue ~8–11am CT, once | the full heavy pull: ratings, polls, schedule, advanced + EPA, **opening lines**, Kalshi, flags, model, picks, grade |
| **sunday** | Sun ~9am–noon CT, once | advanced-stat checkpoint + team trends |
| **weather** | ~6am & ~4pm CT | weather forecast + injuries |
| **preseason** | manual only (Actions tab) | talent, returning production, portal, per-team HFA |

Budget with this cadence: CFBD ~55%/mo, The Odds API ~85–90%/mo (tighter in a
five-Saturday month — `pull-lines` has a hard backstop under 15 credits left).

### The manual buttons

Each `Manual — …` workflow in the Actions tab runs one group on demand,
bypassing the staleness gates (`npm run tick -- --only <group>`). `/admin` also
has per-script buttons and a "Run everything" button.

> **If the data looks stale:** open `/admin` → the freshness panel shows exactly
> which sources are behind. Then check **cron-job.org** (is the tick job green?)
> and **GitHub → Actions** (are the dispatched `Tick` runs succeeding?). Repo
> secrets `DATABASE_URL` / `CFBD_API_KEY` / `ODDS_API_KEY` live under Settings →
> Secrets and variables → **Actions**.

## Setting up the cron-job.org trigger

One job does it. On [cron-job.org](https://cron-job.org) → **Create cronjob**:

- **URL:** `https://api.github.com/repos/ajohnson1952/the-yahngorithm/actions/workflows/tick.yml/dispatches`
- **Schedule:** every 30 minutes (`*/30 * * * *`), or "Every 30 minutes"
- **Request method:** `POST`
- **Request body:** `{"ref":"main"}`
- **Headers:**
  - `Accept: application/vnd.github+json`
  - `Authorization: Bearer <FINE-GRAINED PAT>`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`

The PAT is a **fine-grained personal access token** (github.com/settings/tokens?type=beta)
scoped to **only `the-yahngorithm`**, permission **Actions: Read and write**,
nothing else. A `204` response = success. Rotate it yearly.

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
- **The board looks stale** — first check it's not just the page cache: the
  board/game pages hold their DB results for ~2 min, `/grades` and `/picks` for
  10–15 min (`/admin` is never cached). If it's genuinely behind, hit the
  relevant button on `/admin` (each is one pipeline step; the page lists API
  cost per button). A redeploy also clears every cache.
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
