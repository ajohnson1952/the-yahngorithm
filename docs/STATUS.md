# Status

Living snapshot. `README.md` = architecture, `docs/OPERATIONS.md` = how to run
it during the season, `docs/CALIBRATION.md` = what the backtests found.

## Where it stands (2026 season, week 1)

Everything is built and deployed. The pipeline runs itself on GitHub Actions;
the webapp is live on Render off `main`. Data through 2018 is loaded for the
backtests. **We're in "watch football and grade live" mode.**

## Needs you

- [x] Scheduled-workflow investigation resolved: manual dispatch of Tue-weekly
      now succeeds. Root cause was `pull-lines --type open` hard-failing
      (`process.exit(1)`) when opens already existed for the week, killing the
      whole `&&` chain — fixed to skip gracefully instead. Watch that the
      *scheduled* (not manual) runs start appearing too.
- [ ] Confirm `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are set in the Render
      dashboard (else `/admin` + pinning fall back to the public default `2142`).
- [ ] Run the **Preseason factor refresh** workflow once to confirm the annual
      feeds work in prod.

## Built this cycle

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
- [ ] Isolate the EPA signal as its own small flag (only Yahn component with a
      stable coefficient vs the market — but small).
- [ ] Kalshi "fair-value gap" flag (static book-vs-market divergence).
- [ ] FCS SRS (`pull-ratings` only iterates SP+ rows = FBS today).
- [ ] Bowl / postseason games.
- [ ] Better injury source — ESPN's feed is thin, and injuries are the biggest
      un-priced factor (CALIBRATION.md §4).
- [ ] Top-25 bounded-prior toggle — deprioritised, Yahn isn't a driver.

## Known limitations

- SRS is empty in week 1, noisy through ~week 3 — early spread signal is SP+ only.
- Rating edges on market spreads > ~20 are artifacts (books shade big favorites) — filtered.
- The Odds API is current-week only; historical lines come from CFBD.
- ESPN's CFB injury feed is thin — an empty report means "unknown", not "clean".
- The market is efficient on everything this tool measures from public data.
  Treat it as decision support, not an automated betting system.
