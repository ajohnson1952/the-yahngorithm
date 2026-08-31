# Status

Living checklist. See `README.md` for the architecture overview.

## Done

- [x] Team identity + alias matching (CFBD / Odds API / ESPN → one canonical list)
- [x] Weekly ratings pull — SP+, SRS, pace
- [x] Bill Connelly 772-team SP+ loader → FCS coverage (re-centered onto CFBD's scale)
- [x] Schedule / scores / venue / TV pull
- [x] Betting lines — live snapshots (The Odds API) + historical backfill 2023–26 (CFBD `/lines`)
- [x] Dual→triple spread model (SP+, SRS, Yahn) + totals model
- [x] Situational flags (short week, off bye, travel, revenge, lookahead, letdown)
- [x] Weather (Open-Meteo) + injuries (ESPN, thin)
- [x] Pick generation (corroboration required) + ATS/CLV grading
- [x] AP + Coaches polls, `#rank` badges
- [x] Team trends — ATS / SU / O-U splits with outlier flags
- [x] Kalshi prediction markets — win-prob snapshots, per-game panel
- [x] Market flags — `steam` (dormant until denser snapshots) and `rlm`
- [x] Webapp — board (edge / kickoff sort, week paging), game detail, picks, guide
- [x] `/rankings` — drag-and-drop "My Top 25" → Yahn model
- [x] `/admin` — manual pipeline runs, password-gated
- [x] GitHub Actions schedule (`.github/workflows/`)
- [x] Deployed to Render, `pipeline` merged into `main`
- [x] Totals split around the spread margin (spread & total now consistent)
- [x] Kalshi per-side data + game-page panel; board edge/kickoff sort toggle

## Open — needs you

- [ ] Add repo secrets (GitHub → Settings → Secrets → Actions): `DATABASE_URL`,
      `CFBD_API_KEY`, `ODDS_API_KEY` — the cron does nothing until these exist
- [ ] Add `CFBD_API_KEY` + `ODDS_API_KEY` to the Render service env
- [ ] Set a real Top 25 at `/rankings` (currently seeded from the AP poll)

## Yahn model v2 (multi-factor rating)

- [x] **Build 1 — data layer.** Factor feeds landed (no model change yet):
      `pull-talent` (247 composite), `pull-returning` (roster stability),
      `pull-portal` (transfer net rollup), `pull-advanced` (success rate,
      explosiveness, havoc, PPO, field position, EPA), `compute-team-hfa`
      (per-team home edge). New tables + `/admin` buttons + `preseason.yml`.
- [x] **Build 2 — Yahn v2 composite** wired into `predictedSpreadYahn`:
      SP+ backbone + EPA adj (ramps up through season) + roster adj (talent
      z-score nudge + returning + portal net, decays to 0 by wk 5) + per-team
      HFA. `lib/yahnModel.ts`; breakdown stored (`ModelPrediction.yahnBreakdown`)
      and shown on the game page. Top 25 no longer feeds the model. Portal
      rollup switched to value-over-replacement + ±6 cap; HFA regressed hard
      (PRIOR_N 150, clamp 2.2–4.0) so ~78% of teams land 2.75–3.5.
- [ ] Build 3 — calibration harness (historical backfill + regression vs
      closing lines); tune all `lib/yahnModel.ts` weights; re-evaluate
      per-team HFA (still noisy on 3 seasons — backfill 2019–22 games).
- [ ] Build 4 — Top-25 bounded-prior toggle (off by default) + preview.

## Open — build backlog

- [ ] Make Yahn a formal pick corroborator (2-of-3 model agreement) — calibrate first
- [ ] Kalshi "fair-value gap" flag (static book-vs-market divergence, not just movement)
- [ ] FCS SRS (pullRatings only iterates SP+ rows today = FBS)
- [ ] Bowl / postseason games
- [ ] Better injury source if ESPN stays empty

## Known limitations

- SRS is empty in week 1 and noisy through ~week 3 — spread signal is SP+ only early.
- Rating edges on spreads > ~20 are artifacts (books shade big favorites) — filtered.
- The Odds API is current-week only; historical lines come from CFBD instead.
- ESPN's CFB injury feed is thin — an empty report means "unknown," not "clean."
- `steam` needs line snapshots more than once a day; the gameday workflow provides that.
