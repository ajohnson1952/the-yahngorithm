# Status

Living snapshot. `README.md` = architecture, `docs/OPERATIONS.md` = how to run
it during the season, `docs/CALIBRATION.md` = what the backtests found.

## Where it stands (2026 season, week 1)

Everything is built and deployed. The pipeline runs itself on GitHub Actions;
the webapp is live on Render off `main`. Data through 2018 is loaded for the
backtests. **We're in "watch football and grade live" mode.**

## Needs you

- [ ] **The scheduled workflows have never fired** (GitHub API shows 1 run ever,
      a manual dispatch). The schedule was reworked + re-pushed 2026-09-01 to
      force re-registration. Confirm it took: GitHub → Actions → run **Tue weekly
      refresh** manually (fresh data + proves the secrets), then check that the
      next few scheduled runs appear. If not: re-push a workflow-file change, or
      the repo secrets (`DATABASE_URL`, `CFBD_API_KEY`, `ODDS_API_KEY` under
      Settings → Secrets and variables → **Actions**) are missing.
- [ ] Confirm `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are set in the Render
      dashboard (else `/admin` + pinning fall back to the public default `2142`).
- [ ] Run the **Preseason factor refresh** workflow once to confirm the annual
      feeds work in prod.

## Built this cycle

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
      games** + "★ Pinned" filter; **Current lines** per-book table on the game
      page; Yahn breakdown restyled as a nested block; weather note clarified.
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
