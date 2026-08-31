# Calibration & backtest findings

_Research log. Last run: 2026-08-31, on 2018–2025 historical data._

The question this answers: **does any part of this tool actually beat the
closing line?** Short version — **no clear, stable ATS edge was found**, in
either the power ratings or the situational flags. The tool is decision
support, not an automated betting system. Details below.

---

## 1. What was built to answer it

| Piece | File | What it is |
|---|---|---|
| Point-in-time margin rating | `scripts/computeAsofRatings.ts` → `TeamRatingAsOf` | Ridge-adjusted opponent scoring margin for every `(season, throughWeek)`, shrunk toward a 247-talent preseason prior. Needed because CFBD's SP+ endpoint only serves the **final** rating — useless for an honest backtest. Behaves like a point-in-time SRS; end-of-season top-5s check out every year. |
| Historical feeds | `pull-historical-lines`, `pull-advanced --through N`, `pull-talent/returning/portal --season X` | Opening + closing consensus lines, cumulative advanced stats / EPA at weekly checkpoints, and preseason roster factors, all backfilled 2018–2025 (portal only exists 2021+). |
| Yahn harness | `scripts/backtestHarness.ts` | Walk-forward: for every 2018–25 FBS-vs-FBS game with a closing line, assemble the pre-game feature vector, fit weights on **prior seasons only**, predict 2023 / 2024 / 2025 (~2,200 games). MAE/RMSE + ATS-vs-close with binomial CIs, split by season phase. |
| Flag harness | `scripts/backtestFlags.ts` | Recomputes the situational flags from schedule + as-of ratings (thresholds mirror `computeFlags.ts`), scores betting each flag's implied side vs the close, plus open→close line movement and a simulation of `generate-picks`. 2021–25. |
| Quick check | `scripts/backtestYahn.ts` | The fast, hindsight-biased 2025-only version. Superseded by the harness. |

Reproduce: `npm run compute-asof-ratings && npm run backtest-harness && npm run backtest-flags`.

---

## 2. Yahn v2 (power ratings)

Walk-forward, test seasons 2023–25, n ≈ 2,266.

**Accuracy vs the actual margin (lower = better):**

| Model | MAE | RMSE |
|---|---|---|
| **Closing line (market)** | **12.00** | 15.20 |
| Our as-of margin rating | 12.96 | 16.51 |
| Yahn heuristic (shipped weights) | 12.95 | 16.51 |
| Yahn fitted (weights optimized) | 12.82 | 16.30 |

**ATS vs the closing line** (break-even 52.4%):

| Model | edge ≥ 0 | edge ≥ 2 |
|---|---|---|
| Yahn heuristic | 49.4% [47.3–51.4] | 50.2% [47.7–52.7] |
| Yahn fitted | 50.8% [48.7–52.9] | 51.5% [49.0–54.1] |
| Yahn vs-market residual | 51.1% [49.0–53.2] | 49.5% (n=91) |

**Fitted coefficients (market-residual model):** `talent ≈ 0`, `returning ≈ +1.3`,
`portal ≈ +0.3`, `EPA/play ≈ +2.9`. Only EPA carries a coefficient that
survives against the market — but it's small enough that the model almost
never disagrees with the close by a full point.

### Verdict

- **No ATS edge.** Every variant is 49–51.5%, below break-even, all CIs
  include 50%.
- **Roster factors (talent / returning / portal) are fully priced in** by
  the market.
- **EPA/play has a real but tiny residual signal** (~40% confidence it's
  worth isolating; can't act on it as-is).
- Yahn v2 is **not worse** than a plain rating (~90% confidence) — safe to
  keep displaying.
- **Confidence that Yahn v2 beats the market ATS: ~10–15%.**

**Decision: Yahn stays a displayed third opinion. Not a betting driver, not
a pick corroborator.** The shipped model (`lib/yahnModel.ts`) is fine as-is
for display; its weights are heuristic and there's no gain in tuning them.

---

## 3. Situational flags

Betting each flag's implied side vs the close, 2021–25:

| Flag | Implied bet | ATS | 95% CI | n |
|---|---|---|---|---|
| off_bye | back flagged team | 50.9% | 47.7–54.0 | 963 |
| revenge | back flagged team | 51.7% | 48.7–54.6 | 1086 |
| short_week | fade flagged team | 49.7% | 42.5–56.9 | 185 |
| **travel** | fade flagged team | **54.8%** | 50.1–59.6 | 425 |
| lookahead | fade flagged team | 53.0% | 47.6–58.3 | 334 |
| letdown | fade flagged team | 53.4% | 46.8–59.9 | 223 |
| **any "fade" flag** | fade flagged team | **53.3%** | 50.2–56.4 | 979 |
| any "help" flag | back flagged team | 51.3% | 48.8–53.7 | 1592 |

"Any fade" **by season**: 2021 **51%**, 2022 **49%**, 2023 54%, 2024 58%, 2025 54%.

**Line movement** (open→close ≥ 1 pt): follow 49.5%, fade 50.5% (n=2,077).
Completely dead.

**Simulated `generate-picks`** (as-of rating edge ≥ 2.5 vs close, spread ≤ 20):

| | ATS | CI | n | by season |
|---|---|---|---|---|
| edge only | 49.8% | 47.5–52.1 | 1757 | — |
| + any flag corroboration | 52.8% | 49.0–56.7 | 634 | 2021 44%, 2022 61%, 2023 50%, 2024 58%, 2025 48% |
| …corrob by **travel** | 59.6% | 50.2–69.0 | 104 | |
| …corrob by **revenge** | 55.7% | 50.3–61.1 | 323 | |
| …corrob by **short_week** | **38.6%** | 24.2–53.0 | 44 | |
| …corrob by off_bye | 49.5% | 42.8–56.3 | 210 | |

### Verdict

- **Line movement / steam at the close: dead** (~5% confidence of any
  edge). The move is already in the closing number. "Steam" only has value
  caught *before* the close.
- **"Help" flags (off_bye, revenge as a straight bet): dead** (~51%).
- **"Fade a team in a bad spot" (travel / lookahead / letdown): a weak
  positive lean (~53%), but NOT stable** — flat in 2021–22, ~55% in 2023–25.
  Maybe a real 1–2% edge, maybe noise. ~25–30% confidence it's exploitable.
- **`travel` is the best single flag** (54.8%), and **`travel` / `revenge`
  corroboration of a rating edge is where the pick logic actually works**
  (56–60%, small n).
- **`short_week` corroboration is actively counterproductive** (38.6%) —
  this is a "we've been doing it wrong" finding, even on a small sample.
- The pick logic overall simulates at ~53% but swings 44–61% by season —
  that's a break-even-ish strategy with high variance, roughly scratch
  after −110 juice.

---

## 4. Recommendations

**Do now (low risk):**
1. Keep Yahn displayed; don't weight it, don't make it a corroborator.
2. In `generate-picks`, **drop `short_week` and `off_bye` from the
   corroboration set**; keep `travel`, `revenge`, `letdown`, `lookahead`.
   (Recommended — needs a one-line change + a re-run. Small sample, so
   frame it as a tweak, not gospel.)
3. Add a standalone **"bad spot" lean** on the board — flag when a team has
   any fade flag, especially `travel`. ~53% historical, worth a look even
   without a rating edge.

**Consider:**
4. The `travel` + `revenge` corroboration cells are the only thing that
   looks like a real edge. Tighten the pick logic around them and re-grade
   live in 2026.
5. Isolate the EPA signal as its own small flag rather than burying it in
   the Yahn composite.

**What would actually move the needle (bigger projects):**
- Real injury data (ESPN's feed is thin) — the biggest un-priced factor.
- True early line movement (not just open vs close) via a scraper we're
  allowed to run, or a paid feed — to test "steam" properly.
- Kalshi history (we only have it live going forward) — for real RLM.
- More seasons for the flags (we only have portal-era 2021+ for some).

**The honest framing:** the market is efficient on everything this tool
measures from public data. Treat it as a research surface and a
decision-support dashboard. Grade everything live in 2026 with real,
hindsight-free results before trusting any of these leans with money.
