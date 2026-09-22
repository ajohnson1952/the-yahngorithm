# Status

Living snapshot. `README.md` = architecture, `docs/OPERATIONS.md` = how to run
it during the season, `docs/CALIBRATION.md` = what the backtests found.

## Where it stands (2026 season, week 4)

Everything is built and deployed. The pipeline runs itself on GitHub Actions;
the webapp is live on **Vercel** (the-yahngorithm.com) off `main`, migrated
from Render Sept 16 — see the Sept 16 entry below. Data through 2018 is
loaded for the backtests. **We're in "watch football and grade live" mode.**

Week 1 graded (2–1). Week 2 graded (6–3). Week 3 mostly graded (1–2, 5 picks
still pending as of Sept 22). Week 4 picks are live (5 logged) — see the
Sept 14–15 entries below for the SP+ source-of-record switch (Bill C's sheet,
not CFBD) that governs when picks unlock each week, and the Sept 22 entry for
a CFBD/Odds monthly-quota exhaustion that hit the same day.

## Needs you

- [ ] **Weekly, every week now (not just early season):** when Bill Connelly
      posts an updated SP+ sheet, export it → `data/billc/latest.csv`,
      `npm run load-billc`, commit. His sheet is now the SP+ source of record
      (Sept 15) — CFBD is just the fallback for teams it doesn't cover that
      week, so this upload matters every week, not only while CFBD's own feed
      is stuck on preseason. Rhythm step 0 in OPERATIONS. Watch his X account.
- [x] `NEON_API_KEY` + `CF_BEACON_TOKEN` confirmed in the **Render** service
      env (Sept 15) — since superseded by the Sept 16 Vercel migration; double
      check both actually carried over into the Vercel project env too
      (`docs/DEPLOY_VERCEL.md` has the full var list).
- [x] `ADMIN_PASSWORD` — staying on the public default `2142` for now, by
      choice (Sept 15). Revisit if that ever needs to change.
- [x] **`ADMIN_SESSION_SECRET`** — set in Vercel prod env (Sept 16). Closes the
      gap where the admin cookie was a computable hash of just `ADMIN_PASSWORD`,
      forgeable without hitting the rate-limited login form. Existing admin
      sessions were invalidated by the change (expected — cookie hash shifted),
      re-login required once.
- [ ] Decide re: Neon Free — the pipeline transfer fix landed (Sept 8), so the
      egress blocker is gone. Let a full week run, re-check `npm run neon-usage`
      / the `/admin` panel, then move both projects back to Free if transfer
      projects under 5 GB/mo. Not urgent; Launch is fine meanwhile.
- [ ] Apply the line-movement-arrow fix + the post-kickoff live-lines fix to
      **Cavepicks** (`docs/LINE_MOVEMENT_ARROWS.md`; the live-lines bug is the
      same one described in the Sept 4 entry).
- [x] **CFBD + Odds hit real limits Sept 22** (CFBD monthly quota exhausted,
      Odds down to 13 credits) — fixed same day: rotated both keys, and
      `/admin`'s CFBD bar now tracks the exact `x-calllimit-remaining`
      response header instead of a hardcoded (and wrong) 1000 constant, same
      pattern the Odds side already used. See the Sept 22 entries below.
- [x] New `CFBD_API_KEY` / `ODDS_API_KEY` confirmed in all three places
      (Sept 22): local `.env`, GitHub repo secrets, and Vercel Production
      env vars.

## Built this cycle

### Sept 22 (later) — corrected week 4 SP+, rotated both API keys, exact CFBD quota tracking

Follow-up to the entry directly below, same day:

- **The first week-4 `load-billc` was a false alarm** — Bill C's Google Sheet
  hadn't actually re-published yet; the "fresh" export was byte-identical to
  week 3 (confirmed against git history). The real week-4 sheet arrived
  later: 767/769 common teams show genuine movement (Ohio State overtook
  Georgia for #1, 81.8 vs 80.3). Also arrived as a raw spreadsheet paste
  missing its header row this time — `loadBillcRatings.ts`'s parser assumes
  row 1 is a header and would have silently dropped the new #1 team. Caught
  and fixed before loading.
- **5 of the 6 week-4 picks had been generated off the bad (week-3-repeat)
  data** before the correction landed. All 5 games were still in the future
  (earliest kickoff Sept 26) — deleted them and re-ran `generate-picks`
  against the corrected numbers. 4 re-qualified (same sides, refined edges);
  1 didn't re-qualify. This is exactly the failure mode the Sept 15
  Bill-C-primary switch was built to prevent, just from the upload side
  instead of the CFBD-freshness side — worth remembering that "the sheet
  changed" still needs a sanity check (diff against the last load) before
  trusting it blind.
- **Rotated both `CFBD_API_KEY` and `ODDS_API_KEY`** to fresh keys to ride
  out the rest of the month. Both tested live (direct `curl` against each
  API, outside the app) and confirmed working.
- **CFBD budget tracking now exact, not estimated.** Found CFBD returns the
  real remaining quota via an `x-calllimit-remaining` response header on
  *every* response, success or 429 — mirrored the Odds API's existing exact-
  tracking pattern (`lib/apiUsage.ts`, `lib/cfbd.ts`): `/admin`'s CFBD bar
  now shows the real remaining count, with the bar's total inferred as
  calls-so-far + remaining instead of the hardcoded (and wrong)
  `CFBD_MONTHLY_BUDGET = 1000`. Also stopped `cfbdGet()` from burning 4
  retries with backoff on a quota-exhausted 429 (`remaining === 0`) — it's
  never transient, so it now fails fast. Verified end-to-end: ran
  `pull-rankings` against the new key, confirmed `ApiUsage.lastRemaining`
  landed correctly in the DB.
  - **Known caveat, self-resolving:** the `calls` counter is a plain monthly
    increment that doesn't know a key rotation happened, so it still
    includes calls made against the *old* key. Until the row resets next
    month, the bar's inferred *total* will look inflated (counts pre-
    rotation calls that don't apply to the new key's quota) — but
    `cfbdRemaining` itself is exact regardless, and that's the number that
    actually prevents hitting the wall again.

### Sept 22 — load-billc week 4 + CFBD monthly quota exhausted + Odds credits low

Two unrelated things surfaced the same morning:

- **`load-billc` week 4.** Bill C's data arrived pasted from a spreadsheet
  (row numbers, tab-separated, some cells wrapping across lines) rather than
  as `data/billc/latest.csv`'s plain-CSV format — reconstructed it (only
  Team/SP+/Off/Def matter to the loader; Conference/Record are unused, so the
  reconstruction didn't need to be exact on those). Verified against the
  prior committed file: all 769 common teams matched, only `Record` differed
  (559 teams — expected, more games played); **SP+/Off/Def were numerically
  identical to the Sept 14 load for every team** — worth confirming with the
  source that his sheet's ratings actually moved, since only the record
  column changing is a little suspicious. Loaded anyway since `spPlusSource:
  'billc'` unconditionally satisfies both the week-level and per-team
  freshness gates regardless of whether the number itself moved (see
  `teamHasMoved()`) — 248 rows written, week 4's freshness hold lifted, 5
  picks logged on the next `run-model && generate-picks`.
- **The Tuesday 8am CT weekly tick (run #969) failed.** Root cause: CFBD
  returned `429 {"message":"Monthly call quota exceeded"}` on `/ratings/srs`,
  `/stats/season/advanced`, and `/games` — confirmed directly against the API
  (not a transient rate limit; retrying didn't clear it). `tick.ts`'s
  `hardFail` logic treats *any* failure during the `weekly` group as a hard
  fail by design (unlike every other group, which tolerates a transient
  data-pull outage and retries next tick) — one CFBD-quota 429 was enough to
  take the whole scheduled run red. The rest of the chain (Kalshi, flags,
  model, picks, grading) completed fine; only schedule/ratings/advanced-stats
  refresh was blocked. Re-ran `pull-ratings`/`pull-advanced`/`pull-games`
  standalone afterward — same 429, confirming it's a real monthly cap, not a
  transient blip. **The `/admin` CFBD budget bar never would have warned
  about this** — it showed 728/1000 (a comfortable 73%) because
  `CFBD_MONTHLY_BUDGET = 1000` in `lib/webData.ts` doesn't match CFBD's
  actual enforced limit on this key. Needs a real number from the CFBD
  account page — see "Needs you".
- **Odds API down to 13 credits**, below `pullLines.ts`'s own 15-credit
  floor — its existing backstop will now auto-skip real pulls (not opens,
  which were already 0-cost via the once-only guard) for the rest of
  September. Working as designed; just means line-shopping data goes stale
  until the Oct 1 reset.

### Sept 16 — admin budget panel: split the misleading shared "last updated" timestamp

Reported as: budget panel said the Odds API "ran at 12:38p today," but the
data-freshness tab said Betting lines hadn't pulled since Tuesday 8:01a. Two
separate things, both real:

- **No pipeline bug.** `tick.ts` deliberately skips the `lines` (and `scores`)
  group all day Tuesday and before ~5pm CT Wednesday (`midweekQuiet` — the
  only mid-week games are Tue/Wed MACtion, which doesn't exist most weeks).
  The Odds API genuinely hadn't been called since Tuesday's `open` snapshot;
  freshness was reporting correctly.
- **Real UI bug**, now fixed: `getApiUsage()` (`lib/webData.ts`) collapsed
  the CFBD and Odds `ApiUsage` rows' timestamps into one `updatedAt` (`Math.max`
  of both), rendered as a single "Last updated" caption under *both* budget
  bars. Today that max was a CFBD call (the `ratingsCatchup` step in
  `tick.ts`, which can fire on any day the week's SP+ isn't broadly fresh
  yet) — so the caption showed 12:38p even though the Odds row itself hadn't
  moved. Split `ApiUsageView.updatedAt` into `cfbdUpdatedAt` / `oddsUpdatedAt`,
  each `UsageBar` now shows its own "Last call" line. `npx tsc --noEmit` clean.

### Sept 16 — migrated hosting from Render to Vercel

- **Why:** wanted better uptime + shorter cold starts, staying free/cheap, no
  interest in owning the hardware — Render free-tier specifically sleeps
  after 15 min idle with a ~**50s** cold start, and its 750 free instance-
  hours/mo is shared across the whole account (this app + Cavepicks
  together). Evaluated self-hosting (Pi, Windows desktop — see
  `docs/SELF_HOSTING.md` / `SELF_HOSTING_WINDOWS.md`, kept for reference)
  and GCP Cloud Run before landing on Vercel: purpose-built for Next.js
  (typically ~1-2s cold starts vs. Cloud Run's without manual tuning), a
  first-party Neon integration, and zero-config git-push deploys — same
  simplicity Render gave, less ongoing ops than Cloud Run's Dockerfile/IAM
  setup. **The pipeline never moved** — it's run on GitHub Actions since
  before this change and was already fully decoupled from wherever the web
  app lives (confirmed: nothing in `.github/workflows/` ever referenced
  Render).
- **Live at the-yahngorithm.com** (custom domain, bought for this). Neon is
  unchanged — zero data migration.
- `vercel.json` replaces `render.yaml`: build command runs
  `prisma migrate deploy` before `next build`, same auto-migration-on-deploy
  behavior as before.
- `@vercel/analytics` added alongside the existing Cloudflare Web Analytics
  beacon (kept both — different tools, no conflict). New `app/icon.png`
  favicon too, resized down from the existing 692KB `joe.png` mascot to a
  128×128/36KB PNG via Next's App Router icon convention (drop a file in
  `app/`, zero code needed).
- **Real gotcha worth remembering:** Vercel's project setup prompts an
  "add Prisma Postgres" integration — a *different product* from Neon
  (Prisma's own managed Postgres), unrelated despite the name overlap with
  the Prisma ORM this app already uses. Adding it would provision a new,
  empty database. Skipped; `DATABASE_URL` was set manually to the existing
  Neon connection string instead, per `docs/DEPLOY_VERCEL.md`.
- Also flagged along the way (not yet acted on): the admin session cookie is
  a fixed hash of `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` — with the
  latter unset (still true as of this writing), the cookie is a computable
  hash of a possibly-default password, forgeable by anyone who knows/guesses
  it, without even touching the rate-limited login form. Cheap fix
  (`openssl rand -hex 32`, one env var) that matters more now that the site
  is on a real, findable domain instead of an obscure `*.onrender.com` URL.
- **Real bug, found after Render was shut off:** `/admin`'s "Run" buttons
  were completely broken on Vercel — `spawn /var/task/node_modules/.bin/tsx
  ENOENT`. `app/admin/actions.ts` spawns each pipeline script as a child
  process (`execFile(tsx, [scriptPath])`), referencing files by a
  runtime-built path string rather than a static import. That's invisible
  to Vercel's build-time file tracer, which prunes anything it can't see a
  reference to out of the serverless function bundle — so `tsx` itself
  never made it into `/admin`'s deployed bundle at all. Never an issue on
  Render (a persistent VM just has the whole repo on disk regardless of
  what's statically imported). Fixed with `outputFileTracingIncludes` in
  `next.config.mjs`, scoped to `/admin` — force-includes `tsx` + its
  `esbuild` dependency, the Prisma client/engine, and `scripts/`/`lib/`
  (the scripts' own source, re-parsed fresh by `tsx` in the child process,
  not reused from Next's own bundle). **Confirmed fixed** — "Pull polls"
  (CFBD call + a Prisma write) succeeded on the live Vercel deploy after
  this shipped.
- **Follow-up sweep found two more, fixed proactively before either broke
  anything:** no `maxDuration` set (`/admin` was running on Vercel's
  implicit default, which can be as short as 10s on Hobby — unrelated to
  `runScript`'s own 175s timeout); and `DATABASE_URL` was Neon's direct
  (non-pooled) endpoint doing double duty for both migrations and runtime
  queries — the classic Vercel+Postgres gotcha, since concurrent serverless
  instances each open their own connection against a small (0.25 CU)
  compute's fairly low direct-connection ceiling. Fixed: `maxDuration = 60`
  on `/admin` + internal timeout trimmed to 55s so the app's own clean
  error fires first; `prisma/schema.prisma` got a `directUrl` (Prisma's
  documented pattern) — `DATABASE_URL` is now the pooled endpoint,
  `DIRECT_URL` (new) the direct one for migrations only. Confirmed the
  GitHub Actions pipeline needs no changes (`directUrl` is migration-only,
  never touched by the runtime client — verified by actually running
  `prisma generate` + a real query with `DIRECT_URL` absent before
  shipping). **Confirmed live**: after the two new env vars were added in
  Vercel, "Pull polls" succeeded in 1.7s — fast, no connection-setup
  overhead, pooling working cleanly.

### Sept 15 — Bill C's sheet becomes the SP+ source of record

- **The reversal:** earlier the same day, the recommendation was explicitly
  *against* making Bill C primary (see chat/memory — unproven accuracy edge,
  automation cost, recentering noise). What changed it: CFBD's `/ratings/sp`
  turns out to be a **live, unversioned endpoint** — no working `week` param —
  so two pulls in the same week can genuinely return different numbers for
  the same team. That's the actual root cause behind the JMU @ SDSU incident
  above, and no per-team numeric threshold can fully close a gap like that
  (documented limit on `teamHasMoved`). Bill C's sheet doesn't have that
  problem *by construction*: it only changes when you see his Google Sheet
  update and deliberately export + upload it — a real, discrete,
  human-controlled snapshot. That's a difference in *kind*, not just
  accuracy, and it's what tipped the decision.
- **The wrinkle that would have undermined it:** `load-billc`'s re-centering
  offset was being recomputed fresh from CFBD's *live* numbers every run —
  so even the same CSV, run twice in one week, could produce different
  stored numbers purely from CFBD moving underneath the offset. Fixed by
  anchoring the offset to the season's **week-1 CFBD baseline** instead —
  frozen and immutable once week 1 ends (pull-ratings never touches an old
  week's row again), so the offset is now a pure function of (this CSV,
  week-1 data) and reproduces identically no matter when or how many times
  `load-billc` runs.
- **Pace/possessions preserved** — Bill C's sheet doesn't carry
  `avgPossessionsPerGame` (or SRS), so `pull-ratings` keeps its normal
  weekly CFBD pull for those, merged into the same row `load-billc` owns for
  SP+. No missing data.
- **Rewired:** `loadBillcRatings.ts` — always writes primary
  `spPlusOverall/Offense/Defense` + `spPlusSource:'billc'` for every resolved
  team, FBS included (dropped the old bridge/anti-clobber-until-CFBD-catches-
  up machinery entirely — no more waiting on CFBD). `pullRatings.ts` — never
  overwrites a `spPlusSource:'billc'` row's SP+ fields for that (season,
  week); only refreshes srs/pace for those, and remains the full owner
  (fallback) for any team billc doesn't cover yet that week. `runModel.ts` —
  the Yahn-specific `spPlusOverallBillc` column added earlier the same day
  is now redundant (the primary field itself is billc-sourced) and was
  dropped via migration; Yahn and the plain SP+ model now read the exact
  same backbone.
- **Verified live:** LSU @ Ole Miss wk3 now `spPlusSource:'billc'` for both
  teams, `avgPossessionsPerGame` intact from CFBD, SP+ and Yahn converged to
  the same -6.4 home margin (previously split -7.5 / -6.3 across two
  sources). `generate-picks`' per-team freshness gate (`teamHasMoved`)
  already auto-passed billc-sourced rows before this change — no further
  edit needed there; it now simply has almost nothing left to hold, since
  Wake Forest (held two runs ago as a live example of the bug) cleared the
  moment this week's billc upload covered it.
- **Offset now anchors to week 1 always**, not "current week's CFBD overlap"
  — simpler code, and the band-width canary printed each run is a genuine
  divergence signal now (not conflated with "are we mid-bridge").
- **Same-day audit caught two real bugs before they could bite:**
  (1) `loadBillcRatings.ts`'s week-1 anchor had no guard against being
  overwritten — running `load-billc --week 1` against an FBS-inclusive
  sheet would've silently and *permanently* broken the offset for the rest
  of the season (no recovery path once `pull-ratings` refuses to reclaim a
  billc-owned row). Fixed: FBS teams are now always skipped when writing
  week 1, full stop. (2) `generatePicks.ts`'s stale-SP+ hold message told
  the operator to "run pull-ratings" to clear it — a dead end now, since
  pull-ratings can't refresh a billc-owned team's SP+ at all; fixed to
  point at `load-billc`. Also cleaned up leftover "bridge"/"until CFBD
  catches up" doc-comment framing in `lib/ratingsFreshness.ts`, `tick.ts`,
  and a README table that contradicted the (correct) description two
  sections below it.

### Sept 14 — spread pick sign display bug ("+-3")

- **Bug (user-reported):** spread picks where the away side was actually
  favored displayed as e.g. `AWAY +-3.5` on the picks page, board, and game
  pages — a literal double sign. `pickSide()` in `lib/webData.ts` (and a
  duplicate inline version in `app/game/[id]/page.tsx`) hardcoded a `+`
  onto the away team's spread, assuming the away side is always the
  underdog. True when `marketLine` (the home team's market margin) is
  positive, wrong when it's negative — i.e. exactly the case where the away
  team is favored, which literally happens most weeks.
- **Fix:** derive the sign properly from `marketLine`'s own sign instead of
  assuming a direction (mirrors `components/ui.tsx`'s `spreadStr`, which
  the game page already used correctly for the *home* side — only the away
  branch had the bug). Verified against 4 live picks in the DB with
  negative `marketLine`: all four went from `AWAY +-3.5`-style garbage to
  correct `AWAY -3.5`-style output.

### Sept 14–15 — per-team SP+ freshness gate + Yahn uses Bill C's backbone

- **Bug found:** `spPlusFreshness` gates the whole WEEK on an aggregate
  (>50% of all 138 FBS teams moved off the preseason baseline). Once enough
  *other* teams move, the week is declared fresh and picks unlock for every
  game — even one where a specific team's own CFBD number hasn't actually
  refreshed yet. Caught on JMU @ SDSU (wk 3): a spread pick logged Monday
  morning off a team-rating gap (3.4) that was byte-identical to those two
  teams' week-2 numbers — not a real week-3 read at all. CFBD didn't
  recompute either team until Tuesday's weekly pull, which flipped the
  model's view from "SDSU -5.9ish" to "JMU -2" — an ~8-pt swing on the same
  two non-playing teams within a day. That pick was deleted (never an honest
  week-3 read); re-running left the game a correct near-miss instead.
- **Fix, v1 (wrong) then v2:** first pass compared each team's current week
  to the week-1 preseason baseline — but SDSU/JMU had already moved off
  preseason *during week 2*, so that check would not actually have caught
  the original incident (verified before shipping v2). Corrected:
  `teamHasMoved()` now compares to the immediately PRIOR week instead — a
  national opponent-adjustment solve moves virtually every team some nonzero
  amount each week, so an exact match to last week's number is the reliable
  "stale duplicate" tell. Caveat caught along the way: comparing across a
  source boundary is apples-to-oranges (a CFBD row vs. a billc-bridged prior
  week can look "moved" when CFBD hasn't touched the team at all — confirmed
  on Old Dominion/Wake Forest, whose wk3 CFBD number matches wk1 exactly but
  wk2 was billc-bridged); only same-source weeks are compared, falling back
  to the preseason baseline otherwise. `generate-picks` checks both teams in
  a game before evaluating it (`Held — a team's SP+ hasn't individually
  refreshed yet`, separate from near-misses). Verified live: still correctly
  holds Old Dominion/Wake Forest after the v2 fix. **Known residual gap**
  (documented in `teamHasMoved()`): this reliably catches a team CFBD hasn't
  touched at all, but can't distinguish a genuine small nudge from a stale-
  but-not-frozen intermediate pull — closer to what SDSU/JMU actually hit.
  Closing that fully needs a timing rule (e.g. hold until the Tuesday full
  pull), not a numeric threshold — not built, flagged as a future option.
  OPERATIONS troubleshooting.
- **Yahn model backbone swapped to Bill C's numbers.** Investigating why our
  `load-billc` recentered numbers diverge from CFBD's own SP+ (up to 7-8 pts
  for a few teams) turned up a real pattern: divergence concentrates almost
  entirely in teams that have already played an FCS opponent — plausible
  since CFBD's `/ratings/sp` is FBS-only and has no real FCS ratings to
  opponent-adjust against, while Bill C's 772-team sheet does. New
  `TeamRatingWeekly.spPlusOverallBillc`, written for every resolved team
  (FBS included) on every `load-billc` run regardless of whether CFBD already
  owns the primary `spPlusOverall` for that team/week. `run-model`'s Yahn
  backbone now reads `spPlusOverallBillc ?? spPlusOverall`; the plain SP+
  model and `generate-picks` are untouched — still pure CFBD, so that model
  line's grading history doesn't change. Deliberately *not* a wholesale
  switch to Bill C as the FBS source of record — see the reasoning in
  chat/memory: a manual weekly sheet becoming the sole input for every FBS
  team loses the pipeline's automation, and a single divergent example isn't
  evidence either source is more accurate.

### Sept 8 — pipeline-side transfer fix (Neon egress)

- `run-model`, `generate-picks` and `compute-market-flags` each ran
  `prisma.line.findMany({ where: { game: { season, week } } })` — the **whole
  week's** `Line` history — on every ~30-min heartbeat. By Saturday that's 40k+
  rows (wk 1: 41,399); three consumers × 48 ticks/day re-reading all of it was
  the bulk of the ~29 GB/mo Neon transfer. Pipeline twin of the Sept 2 webapp
  fix.
- New `lib/lineWindows.ts` mirrors `buildWeekBoard`'s pattern: `groupBy` gameId
  on `_max(capturedAt)`, then a per-game windowed `findMany` (per-game anchor,
  not one global cutoff — a game's last pull can be hours old).
  - `latestLineBatchByGame` → just each game's newest snapshot batch
    (`capturedAt >= max − 95 min`). Used by `run-model` + `generate-picks`;
    `consensusByGame` only ever reads the latest batch. **wk-1 check: 41,399 →
    4,838 rows off the wire (−88%), consensus byte-identical for all 99 games.**
  - `recentLinesByGame` → a trailing 40 h window per game (clears RLM's 30 h
    lookback with margin). Used by `compute-market-flags` for its steam (8 h) /
    RLM (30 h) scans. Smaller cut than the other two mid-week — a steam move
    older than ~40 h no longer registers, which matches the Sept 3 "trailing
    window" intent.
- Also trims the `select` to the six columns anyone reads (drops id/source/
  price). `lib/webData.ts` left as-is (already fixed Sept 2, more elaborate
  shape). Est. transfer after: well under the 5 GB Free cap → Neon Free viable
  again.

### Sept 8 — budget check + ATS-trends fix + `/venues` cache

- **Budget read (7 days into September, on the Neon Launch plan):**
  - **Neon** — compute ~77 CU-h/mo proj, storage 0.09 GB, transfer ~29 GB/mo
    proj. All comfortably inside Launch. **But transfer at ~29 GB/mo is 6× the
    Free 5 GB cap** → can't move back to Free without the pipeline transfer fix
    (backlog, below). `npm run neon-usage`.
  - **CFBD** — 345 calls in ~7 days → straight-lines ~1,500/mo vs the 1,000
    budget, but that's inflated by wk 1's long game window + manual runs; real
    steady-state ~700–800.
  - **Odds API** — 135 credits used, 365 left; designed to run ~85–90% with a
    hard <15-credit backstop. Fine, watch the `/admin` bar mid-month.
- **ATS team trends were broken.** `computeTeamTrends` filtered lines to
  `snapshotType: "close"` — CFBD only backfills those for *finished* seasons
  (8 of 99 wk-1 games had one), so ATS splits were computed off a near-empty
  subset and disagreed with `grade-picks`. Extracted `closingConsensus()` to
  `lib/consensus.ts` (explicit `close` → else median of all pre-kickoff
  snapshots) and used it in both. After: all 186 teams have a closing line for
  every game. (Outlier chips still need n ≥ 8 — won't appear until ~wk 8.)
- **`/venues` cached.** `pull-games` re-fetched CFBD's ~850-row venue dump every
  run (~hourly in game windows); now cached in `Meta` with a 7-day TTL —
  ~200 CFBD calls/mo saved.

### Sept 8 — Bill C bridge (Option A) + anti-clobber

- The operator gets Bill Connelly's updated SP+ sheet weekly (`data/billc/
  latest.csv` → `npm run load-billc`). From wk 2 on, while CFBD's `/ratings/sp`
  feed is still on the preseason projection, `load-billc` now also **bridges**
  his re-centered numbers over the **FBS** teams (not just FCS) — automatically,
  or forced with `--overwrite-fbs`. This lifts the pick hold (below) without
  waiting on CFBD's ingest lag. Spread picks are pure rating *differentials*, so
  the re-centering offset cancels.
- **Anti-clobber:** `pull-ratings` now skips any `spPlusSource:"billc"` row for
  a week until CFBD itself has moved off the preseason baseline
  (`movedFraction > 0.5`), then reclaims it (`spPlusSource` → null). SRS / pace
  still refresh on the held rows.
- Shared helpers `preseasonBaseline()` / `movedFraction()` in
  `lib/ratingsFreshness.ts`. Offset now anchors on the latest *full* CFBD slate
  (falls back to wk 1 once a week's FBS rows are all bridged); band-divergence
  warning relaxed while bridging (CFBD-stale divergence is the point);
  `USF` → `South Florida` added to `NAME_OVERRIDES`. The Sheets-mangled "Record"
  column ("1-0" → serial date) is ignored from wk 2 on.
- Applied to prod wk 2: 138 FBS + 110 FCS `billc` rows, `run-model` +
  `generate-picks` re-run → 6 wk-2 picks off the updated numbers (Cal/Syracuse
  flipped side vs the preseason version). Weekly rhythm step 0 in OPERATIONS.

### Sept 8 — early-season SP+ hold on picks

- CFBD's SP+ is the **frozen preseason projection** until Bill Connelly's first
  in-season revision (~wk 2–3), and the feed strips the postgame fields
  (`secondOrderWins` / `sos` are null even for a finished season) — no flag to
  read. Generating picks in that window pits a preseason model against a market
  that's already watched a week of football; the "edge" is mostly staleness.
  (Also surfaced: the "nothing beats the close" backtest used `TeamRatingAsOf`,
  **not** CFBD SP+ — the live pick driver has never actually been backtested.)
- `lib/ratingsFreshness.ts` `spPlusFreshness()` detects the update structurally
  (> 50 % of teams moved off the season's earliest snapshot). `generate-picks`
  now **holds every pick** for a week until it's fresh (week 1 exempt — the
  market's on preseason info too). `tick.ts` pulls ratings ~daily instead of
  only Tuesday once week ≥ 2, until it lands.
- Deleted the 6 wk-2 picks that had been logged off preseason SP+. Guide §6.

### Sept 8 — default week + stranded-week sweep

- `currentWeek()` rewritten: show the earliest week that still has an unplayed
  game, holding the just-finished week only ~12 h past its last kickoff
  (`WEEK_HOLD_MS`) instead of a flat 36 h — so a fully-final week advances by
  Monday/Tuesday while Saturday's results still sit up Sunday morning.
  Deliberately independent of CFBD's calendar (which rolls the instant a week
  technically ends). Stale non-final rows (kickoff > 18 h ago, still not
  "final") are ignored so one bad row can't wedge the site on an old week.
- Root cause it exposed: **SMU @ FSU sat "scheduled" with no score for a day**
  — CFBD's calendar advanced to wk 2 before its Monday-night result landed, and
  a no-arg `pull-games` only ever asks for the current week. `pull-games` now
  also sweeps any recent week with an overdue non-final game (multiple weeks →
  one year-wide CFBD call). Ran `pull-games --week 1` once to capture the final
  (SMU 27–24). OPERATIONS troubleshooting.

### Sept 5 — `/watch` live scores + re-ranking

- The watch guide pulls **live scores from ESPN's public scoreboard**
  (`lib/liveScores.ts`) on every page load / refresh — never stored, never in
  the pipeline, 15 s shared fetch cache, matched to our games by normalized
  team-name pair, every failure falls back to the pregame numbers.
- `scoreGame` gets a live delta (`lib/watchGuide.ts` `liveDelta()`): one-score
  game **+12 → +36** as it goes late, blowout **−16 → −46**, overtime +36,
  final −70 (benched with the result). 1st-quarter scores damped ×0.45. Live
  status leads the card's reasons; a green **● LIVE** badge shows ESPN's clock.
- `WatchAutoRefresh` (client) — `router.refresh()` every 60 s + manual button +
  on/off toggle, shown only when a game is live or kickoff is within ~45 min.
- `buildWatchWindows(games, now)` — the window that's on *now* trusts ESPN over
  the ~3h40m estimate (an in-progress game holds its slot even if it runs long;
  a finished one frees it); later windows still use the estimate. Once a later
  window starts, the finished ones collapse into an "earlier windows today"
  roll-up (today's date only).
- `weeksWithGames` wrapped in `unstable_cache` (10 min, `groupBy`) — the
  refresh loop hits it every render. Guide §10–11, README.

### Sept 2 — performance + line-honesty pass

- **Neon transfer cap fix.** A `force-dynamic` homepage was re-running
  `getWeekBoard` on every visit, and its `line` / `modelPrediction` queries
  pulled the *entire* per-game history to use only the newest snapshot — 5 GB
  of free-tier transfer gone in days. Now: each page's DB work sits behind
  `unstable_cache` keyed on `(season, week)` (~2 min board / game, 10–15 min
  `/grades` `/picks`); line + prediction reads are anchored per-game to just
  the latest (and, for the movement arrow, earliest) snapshot batch via
  `groupBy`. Per-visitor pins split into a separate uncached lookup. `/admin`
  never cached.
- **Picks lock to a real book line.** `lib/consensus.ts` `modalLine()` — the
  most-posted number across books, not the inter-book `median()` (which gave
  un-bettable lines like "Over 58.3"). `generate-picks` and the board's market
  spread/total + edges now use it; the model's own prediction stays exact.
  `median()` still backs `compute-trends` / `grade-picks`. One-off: the
  existing wk-1 Hawai'i pick was hand-corrected 58.3 → 58.
- **Line-movement arrow** on each board card — ▲/▼ + points from the first
  recorded line (open, or earliest live pull; baseline resolved per-game).
  Spread arrow measures **distance from pick'em**, not signed value (a
  favorite line coming down = ▼, not ▲); crossings show the full points moved.
  Rationale + portable fix for Cavepicks: `docs/LINE_MOVEMENT_ARROWS.md`.
- Guide (§2, §6, §10) + README updated for all of the above.
- Bug found & fixed in the same pass: the per-visit query trim briefly made
  **completed games drop their market line** on the board (their last pull is
  days old); fixed by the per-game window above.

### Sept 4 — `/watch`: quadbox viewing guide

New page/tab, not a betting tool — plans a day of watching. `lib/watchGuide.ts`
scores every game 0–100 (40% projected competitiveness, 30% ranked-team
stakes, 15% pace, 15% rivalry via the `Rivalry` table; FBS-vs-FCS capped low)
and slices the day into windows of "which 4 games to have on," recomputed only
when the actual top-4 changes (fixed ~3h40m game length, 45-min kickoff
clustering). Pure computation over the already-cached `getWeekBoard` output +
a tiny cached rivalry lookup — no new DB load. Day/week nav, added in `Nav.tsx`,
guide §11.

### Sept 4 — stop recording lines after kickoff

- The Odds API keeps serving **live in-game prices** after a game starts (a team
  up 21 shows as −35). `pull-lines` was recording them as `Line` rows, which read
  as ~40-pt "line moves" everywhere downstream — consensus, the movement arrow,
  steam/rlm. Hit a bunch of Thursday-night wk-1 games.
- Fix (`scripts/pullLines.ts`): skip any event whose game kicked off > 10 min
  ago (`--force` overrides), plus a self-healing sweep every run that deletes
  post-kickoff `odds_api` rows. The last pre-kick snapshot is the de facto close.
- Cleaned 109 stale rows; re-ran `compute-market-flags` (garbage steam flags
  cleared, 10 → 2). Grading was already safe (`closingConsensus` filters
  `capturedAt <= kickoff`).

### Sept 3 — RLM flag reworked

- `rlm` in `compute-market-flags` was comparing open→now for the book (so a
  line that settled 2 pts off a soft opener days ago and then held kept the
  flag on all week — e.g. Tulane/Duke), and it fell back to a noisy first-daily
  line when there was no `open` snapshot.
- Now: **trailing 30 h window**. The book must have moved within the last ~30 h,
  and Kalshi must not have confirmed it over the *same* window; needs a real
  snapshot old enough to sit before the window, so it never anchors to a thin
  first pull. Guide §9 + the stale "steam is dormant" note fixed (`pull-lines`
  runs ~6×/day now — steam fires in a normal week).
- Result: wk-1 `rlm` went 1 → 0 (the stale Tulane/Duke one cleared); `steam`
  still firing (Akron @ Wake Forest, 2 pts / 2.7 h).

### Sept 3 — Neon plan / cost

- Upgraded Neon Free → **Launch** (usage-based, ~$5/mo) after the transfer-leak
  bug. Compute pinned min=max **0.25 CU** (endpoint was set to autoscale to 8!),
  autosuspend stays 5 min (Launch won't allow lower). Storage 71 MB, history
  retention 6 h — both minimal.
- `npm run neon-usage` (CLI) + a **Neon panel on `/admin`** — compute / transfer
  / storage for the billing period vs the Free-tier caps (100 CU-h / 5 GB /
  0.5 GB) with a straight-line projection. `lib/neonUsage.ts` fetches; admin
  wraps it in `unstable_cache` (10 min). Needs `NEON_API_KEY` — in `.env`
  locally, and in the **Render service env** for the live admin panel (degrades
  to a "set the key" note without it).
- Plan: run normally ~2 weeks, then use `neon-usage` to decide whether to move
  both projects back to Free. Compute + storage will fit easily; **transfer is
  the swing factor** (steady-state estimate ~3–4.5 GB/mo vs the 5 GB Free cap).

### Sept 3 — FBS-vs-FCS lines not pulling

- `matchTeamAliases` only seeds from CFBD `/teams/fbs`, so FCS opponents never
  got an `odds_api` alias — the Odds API's "Tennessee State Tigers" wouldn't
  resolve and `pull-lines` dropped the **whole event**, costing the FBS side
  (e.g. Georgia) its line. ~48 of 99 week-1 games affected.
- `pull-lines` now rescues these: when one side resolves, it names the other
  from our own schedule (leading-name overlap, or the known team's only game
  near that kickoff) and learns the alias. Week 1 went 43 → 99/99 games with a
  line. Added the missing `Maryland Terrapins` alias by hand.

### (prior cycle)

- **Yahn model v2** — `lib/yahnModel.ts`: SP+ backbone + EPA adj (ramps up
  through the season) + roster adj (talent z-score nudge + returning + portal
  net, decays to 0 by wk 5) + per-team HFA. Component breakdown on the game
  page. Factor feeds: `pull-talent` / `pull-returning` / `pull-portal` /
  `pull-advanced` / `compute-team-hfa`.
- **Per-team HFA** — rules-based: `2.7 + max(altitude bump, hostile-venue
  bump)`. Altitude data-supported; hostile list hand-set (LSU/A&M/PSU/Oregon
  +0.40 … VT/Texas/SC/WVU/Iowa/UW/ND/MissSt/OleMiss/Michigan +0.15). 34
  venues adjusted, rest flat 2.7. (Deriving it per-team from history failed —
  see CALIBRATION.md.)
- **Calibration harness** — `TeamRatingAsOf` (point-in-time ridge margin
  rating), `backtestHarness.ts`, `backtestFlags.ts`, `backtestYahn.ts`.
  Verdict: **no ATS edge over the closing line** anywhere — power ratings or
  flags. Closest to signal: fading travel/trap spots (~53–55%,
  season-inconsistent) and travel/revenge corroboration of a rating edge
  (~56–60%, small n). See CALIBRATION.md.
- **Pick logic** — corroboration set trimmed to `travel` / `lookahead` /
  `letdown` / `revenge` (`short_week` + `off_bye` dropped — they backtested at
  or below 50%; still shown on the board). Simulated logic 52.8% → 56.4%.
- **`bad_spot` flag** — fires on a team with 2+ stacked hurt situational flags.
  Red chip + "Bad spots" board filter. Display only, doesn't corroborate picks.
- **Security pass** — hashed admin cookie, timing-safe compare + login
  throttle, `Secure` cookie in prod, security headers, 20s fetch timeouts,
  `week` param validation, `saveRanking` input validation, `computeFlags`
  no longer wipes market flags.

## Backlog

- [x] **Grade all three spread models + every flag live vs the closing line**
      (`grade-picks` → `ModelGrade` table → `/grades` page). Frozen at first
      grading. The season-long verdict.
- [x] `/rankings` parked — off the nav, banner on the page, route kept so the
      data + the bounded-prior option survive.
- [x] **Schedule reworked** — heartbeat (every 3h: Kalshi + model + picks),
      lines.yml (every game day incl. Wed/Sun/Mon), daily ×2, tue grades first.
- [x] **Board**: game cards show SP+ only (no wrap into the edge); completed
      games → trailing "Final" section; by-edge sub-sorts by kickoff; **pin
      games** (open to everyone, not admin-gated) + "★ Pinned" filter;
      **Current lines** per-book table on the game page; Yahn breakdown
      restyled as a nested block; weather note clarified.
- [x] **`/admin` gets a live API budget panel** — CFBD call count (best-effort,
      `ApiUsage` table) and The Odds API's real remaining credits (from its own
      response headers), both as progress bars. "Admin" added to the nav.
- [x] **Pipeline-side transfer fix** — done Sept 8 (see "Built this cycle").
      `lib/lineWindows.ts`; `run-model` / `generate-picks` −88% rows off the
      wire, `compute-market-flags` on a trailing 40 h window.
- [ ] Isolate the EPA signal as its own small flag (only Yahn component with a
      stable coefficient vs the market — but small).
- [ ] Kalshi "fair-value gap" flag (static book-vs-market divergence).
- [ ] FCS SRS (`pull-ratings` only iterates SP+ rows = FBS today).
- [ ] Bowl / postseason games.
- [ ] Better injury source — ESPN's feed is thin, and injuries are the biggest
      un-priced factor (CALIBRATION.md §4).
- [ ] Top-25 bounded-prior toggle — deprioritised, Yahn isn't a driver.

## Known limitations

- CFBD's SP+ is frozen at the preseason projection until Bill Connelly's first
  in-season revision (~wk 2–3). Picks are **held** for the week until it moves
  (via CFBD or a `load-billc` bridge) — see the Sept 8 entries.
- SRS is empty in week 1, noisy through ~week 3 — early spread signal is SP+ only.
- Rating edges on market spreads > ~20 are artifacts (books shade big favorites) — filtered.
- The Odds API is current-week only; historical lines come from CFBD.
- ESPN's CFB injury feed is thin — an empty report means "unknown", not "clean".
- The market is efficient on everything this tool measures from public data.
  Treat it as decision support, not an automated betting system.
