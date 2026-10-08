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
| *(quiet hours)* | 10pm–8am CT, except Sat night until 2am | nothing — the tick exits before any DB call so Neon stays asleep. Manual `--only` runs still work. |
| **heartbeat** | every tick (~30 min) | Kalshi, market flags, model, picks — all free |
| **scores** | game windows (all week except Tue daytime) | `pull-games` + `grade-picks` — ~30 min on Saturday, ~hourly otherwise. A final is graded within ~30 min |
| **lines** | game windows, never Tuesday | `pull-lines --daily` — every ~30 min in the Sat 9a–8p core, every ~4 h otherwise (paced off the last attempt, not the last saved line). Skips for free once every game in the week has kicked off, and self-limits when monthly Odds credits run low. `npm run cfbd-usage` shows CFBD's own meter before/after each tick |
| **weekly** | Tue ~8–11am CT, once | the full heavy pull: ratings, polls, schedule, advanced + EPA, **opening lines**, Kalshi, flags, model, picks, grade |
| **sunday** | Sun ~9am–noon CT, once | advanced-stat checkpoint + team trends |
| **weather** | ~8am & ~4pm CT | weather forecast + weather flags |
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

0. **When Bill Connelly posts an updated SP+ sheet** — export it to
   `data/billc/latest.csv`, run `npm run load-billc`, commit the CSV. His
   sheet is the **source of record** for SP+ (overall/offense/defense),
   FBS included, not a temporary bridge: CFBD's own `/ratings/sp` is a live,
   unversioned endpoint (no working `week` param), so two pulls of it in the
   same week can return different numbers for the same team — that caused a
   real bad pick once (JMU @ SDSU wk3, see STATUS.md). Bill C's sheet only
   changes when you deliberately upload it, so it's the one thing in this
   pipeline whose "did this actually update" question has a clean answer.
   `pull-ratings` never overwrites a team `load-billc` has already claimed
   for the week — it only refreshes SRS + pace/possessions (which his sheet
   doesn't have), and it's the automatic fallback for any team not in that
   week's sheet. Run `npm run run-model && npm run generate-picks` after
   uploading, or just wait for the next tick. (The mangled "Record" column
   in the export is ignored — no need to fix it.)
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
- **An FBS game shows no betting line** (esp. vs an FCS opponent) — `pull-lines`
  couldn't match the Odds API's name for one team. It now self-heals for
  FBS-vs-FCS games (it names the FCS side from our schedule and learns the
  alias), but if a **real FBS team** name is new to the Odds board it can miss.
  The `pull-lines` log prints any it couldn't resolve; add the alias by hand
  (`team_source_aliases`, source `odds_api`) or re-run
  `npx tsx scripts/matchTeamAliases.ts` to refresh from the current board.
- **`/admin` buttons fail in prod** — `CFBD_API_KEY` / `ODDS_API_KEY` also need
  to be in the Vercel project env.
- **A finished game still shows "scheduled" / no score** — usually a week that
  ended just as CFBD's calendar rolled to the next one. A plain `pull-games` now
  sweeps any recent week with an overdue non-final game automatically, so it
  should self-heal on the next `scores` tick; to force it, run
  `pull-games -- --season <yr> --week <n>` (or `-- --all`, same 1-call cost).
- **The default week looks off** — `/` shows the earliest week that still has an
  unplayed game, holding the just-finished week for ~12h after its last kickoff
  (so Saturday's results stay up Sunday morning, then it advances). This is
  independent of CFBD's calendar. Knob: `WEEK_HOLD_MS` in `lib/currentWeek.ts`.
- **No picks are being logged for the week** — check the `generate-picks` log
  for `⏸ Bill C's SP+ isn't loaded for week N yet`. Expected until you run
  `load-billc` for the week (step 0 of the weekly rhythm): from week 2 on,
  picks come **only** from Bill C's numbers. CFBD's SP+ fills the week's rows
  in the meantime so the board has model lines, but it never produces a pick —
  `pull-ratings` can't clear this. The first tick after the upload logs the
  picks (or run `generate-picks` from `/admin`).
- **One specific game isn't getting a pick even though the sheet is loaded** —
  check the log for `Held — a team isn't on Bill C's sheet this week`. One of
  the two teams didn't resolve against his sheet (see `load-billc`'s
  "Unresolved sheet names" list), so it's still on CFBD's fallback number. Fix
  the name mapping (`NAME_OVERRIDES` in `scripts/loadBillcRatings.ts`) and
  re-run `load-billc`.

## The Grades page

`grade-picks` (Sunday) now scores **all three spread models and every flag**
against the closing line on each final game, frozen at first grading, into
`ModelGrade`. The **Grades** page is the season-to-date scoreboard: ATS record
and win % for each model (overall + on edge ≥ 2) and each flag, vs the 52.4%
break-even.

Small samples early — one week is noise. The point is the trend by ~week 8:
if SP+ / Yahn / a flag is sitting at 50% on 100+ games, that's the honest
verdict. The backtests say to expect exactly that.
