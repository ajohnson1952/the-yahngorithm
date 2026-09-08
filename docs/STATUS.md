# Status

Living snapshot. `README.md` = architecture, `docs/OPERATIONS.md` = how to run
it during the season, `docs/CALIBRATION.md` = what the backtests found.

## Where it stands (2026 season, week 2)

Everything is built and deployed. The pipeline runs itself on GitHub Actions;
the webapp is live on Render off `main`. Data through 2018 is loaded for the
backtests. **We're in "watch football and grade live" mode.**

Week 1 graded (picks 2–1). Week 2 picks are live — see the Sept 8 entries below
for the SP+ preseason-hold and the Bill C bridge that gate/release them.

## Needs you

- [ ] **Weekly, early season:** when Bill Connelly posts an updated SP+ sheet,
      export it → `data/billc/latest.csv`, `npm run load-billc`, commit. That's
      what releases the pick hold before CFBD's feed catches up (rhythm step 0
      in OPERATIONS). Watch his X account.
- [ ] `NEON_API_KEY` + `CF_BEACON_TOKEN` in the **Render service env** (for the
      `/admin` Neon panel + Cloudflare analytics in prod). `.env` has them
      locally. `CF_BEACON_TOKEN=5ee1b043463a4b58bd546d9eac3122c3`.
- [ ] Confirm `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` are set in the Render
      dashboard (else `/admin` + pinning fall back to the public default `2142`).
- [ ] Decide re: Neon Free — the pipeline transfer fix landed (Sept 8), so the
      egress blocker is gone. Let a full week run, re-check `npm run neon-usage`
      / the `/admin` panel, then move both projects back to Free if transfer
      projects under 5 GB/mo. Not urgent; Launch is fine meanwhile.
- [ ] Apply the line-movement-arrow fix + the post-kickoff live-lines fix to
      **Cavepicks** (`docs/LINE_MOVEMENT_ARROWS.md`; the live-lines bug is the
      same one described in the Sept 4 entry).

## Built this cycle

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
