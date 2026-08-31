# Interpretation Guide (the cheat sheet)

How to read what this tool outputs. This is a **living document** — every time we
add a signal to the pipeline, we add a section here explaining what it means and
how much to trust it. By the end of the season this should be enough for someone
to sit down with a week's output and know what they're looking at.

Ground rule from the project brief: this is **decision support**, not a
money-printer. Betting markets are efficient. The honest claim is "here's where my
models and the market disagree, and here's my tracked record when that's
happened" — nothing more.

---

## 1. The two spread models: SP+ and SRS

We run **two independent power-rating spread models** on every game and store both
(`ModelPrediction.predictedSpreadSpPlus`, `ModelPrediction.predictedSpreadSrs`).

| | SP+ | SRS |
|---|---|---|
| Source | CFBD `/ratings/sp` | CFBD `/ratings/srs` |
| What it measures | Opponent-adjusted **play-by-play efficiency** | Opponent-adjusted **scoring margin** |
| Built to | Predict future performance | Describe what happened |
| Coverage | FBS only | FBS + most FCS |
| Offense/defense split | Yes (feeds the totals model too) | No — single number, spread only |

Both are on the same scale ("points better than an average team"), so both models
are just:

```
predicted_margin = home_rating - away_rating + home_field_advantage
```

### How to read them together

**They agree (within ~1.5 pts of each other):** the rating signal is stable. If
that agreed prediction also diverges from the market by a meaningful amount, that's
your strongest rating-based case.

**They disagree (more than ~3 pts apart):** treat the game as lower-confidence and
look at *why*. SRS is driven by margin, so it moves apart from SP+ when a team:

- **SRS much higher than SP+** — team has been running up the score in blowouts,
  and/or won several close games (SRS rewards the margin and the win; SP+ sees the
  efficiency underneath was ordinary). Their record/margin overstates them. Fade
  spots.
- **SRS much lower than SP+** — team has *lost* close games or gotten blown out
  once or twice, but moves the ball efficiently play to play. SP+ thinks they're
  better than their scoreboard results. Buy-low spots.

**Rule of thumb:** when the two models disagree, lean on **SP+** for the
prediction (it's the predictive one) but *lower the confidence* and note the SRS
gap as a caution flag. When they agree, confidence goes up.

**Early season (roughly weeks 1–3): ignore SRS entirely.** SRS is computed from
games actually played, so it's empty in week 1 and wildly noisy through about
week 3 (one blowout swings it 20+ points). Until it settles, the spread signal is
SP+ only, and SP+ itself is still mostly preseason projection in weeks 1–2 — so
weight *all* rating-based edges lightly early and lean harder on situational
flags and obvious market mispricings.

> This SP+/SRS gap is one of the "second independent signal" inputs the brief asks
> for — a spread edge that **both** models see is worth more than one either sees
> alone.

### What does NOT get a pick

- A game where only one model shows an edge and the other is flat or opposite —
  unless a situational flag independently corroborates it.
- Any FBS-vs-FCS game (no SP+ for the FCS side; SRS alone isn't enough).

---

## 2. Reading a spread edge

**edge = predicted home margin − market home margin** (both "+ = home favored").
- `edge > 0` → model likes the **home** side
- `edge < 0` → model likes the **away** side
- `|edge|` = points of disagreement

From the brief: a game is only a *pick candidate* if `|edge| ≥ 2.5` **and** a
second independent signal (SRS agreement, or a situational flag) corroborates it.
A lone model disagreement is not a pick.

### The edge is NOT uniform across the spread — this matters a lot

The model's raw output over/under-values games very differently depending on how
big the spread is:

| Market spread | What a model edge there usually means |
|---|---|
| **Pick'em to ~ −10** | This is where the market is sharpest and where a real edge is most believable. A corroborated 2.5–4 pt edge here is the bread and butter. |
| **~ −10 to −20** | Still meaningful, but rating noise is larger. Want a bigger edge (3.5+) and corroboration. |
| **Bigger than ~ −20** | **Mostly ignore the edge.** Sportsbooks deliberately *shade big favorites down* — the public won't lay 40, and backdoor covers / garbage-time swings make the real margin wildly variable. SP+ will almost always say "the favorite should be favored by even more," and that is an artifact, not an edge. Week 1 example: model said Ohio State −60 vs Ball State, market −50.5 → a fake +9.8 "edge." |

Practical rule: **an edge on a spread bigger than ~20 points needs to be treated
as noise unless something very specific explains it** (a key injury the market
hasn't priced, weather, etc.). Don't put those on the candidate list.

### Early-season caveat (repeat of §1)

Weeks 1–2 the SP+ numbers are still mostly preseason projection and SRS doesn't
exist. Everything in this section is at its least reliable then. Lean on flags and
obvious market mispricings, not rating edges.

---

## 3. Totals model

How it's built (`ModelPrediction.predictedTotal`):

```
each team's expected points = midpoint of (its SP+ offense) and
                              (opponent's SP+ defense), at average pace
expected possessions        = home pace + away pace   (drives/game, ~11.6 each)
                              blended: prior season early, current season as it accrues
predicted total = (home pts + away pts) × (possessions / league-average)
                  − wind adjustment
```

`predictedPossessions` and each team's `homeExpectedPpp` / `awayExpectedPpp`
(points per possession) are stored alongside the total.

- **Only SP+ feeds this** (it needs the offense/defense split; SRS is one number).
- **It's noisier than the spread model** — the brief says so and it's true. Use a
  higher bar: a totals edge under ~3.5 points is noise. Weight totals picks lower
  than spread picks of the same nominal edge.
- **In aggregate it's well calibrated** — across a slate the model total and the
  market total average out to within a point.

### Where the totals model lies to you

**Big mismatches.** When one team is a heavy favorite, the weak team's low SP+
offense drags the model's total down hard, but the market keeps the total up
because (a) the favorite alone will score 40+ and (b) garbage-time scoring is real.
So the model's biggest "UNDER" edges cluster on blowout games — and those are
mostly artifacts, the same way big-favorite spread edges are (§2). Week 1 example:
model said Ball State / Ohio State 45, market 56.5 — the model is wrong there, not
the market. **Trust totals edges most on competitive games (spread inside ~14).**

### What the pace number tells you

`predictedPossessions` in the low 20s = a slow, grind-it-out game (two
run-heavy teams, e.g. anything with Air Force or Army — ~19–20). Mid-20s = fast
(Texas Tech, Ole Miss, Coastal Carolina games run 25–27). A pace mismatch the
market underrates is one of the few repeatable totals edges.

---

## 4. Weather and injuries

### Weather (`Weather` table, from Open-Meteo — free, no key)

Pulled per game as a **snapshot** (never overwritten), so you can see the
forecast drift from Tuesday to Saturday. Indoor games are skipped entirely.
Stored: temperature, wind (mph, sustained), precipitation probability.

What actually moves a number:

| Condition | Effect |
|---|---|
| **Wind ≥ 15 mph sustained** | The one weather factor that reliably matters. Suppresses passing and field goals → **lean the total UNDER**. ≥ 20 mph is a strong under signal. Barely affects the spread. |
| **Wind 10–15 mph** | Minor. Note it, don't act on it alone. |
| Heavy rain / snow | Modest under lean; also nudges toward the run-heavier team ATS. Overrated by the public — the wind that usually comes with it matters more than the precipitation. |
| Cold (< 25°F) | Small under lean, mostly priced in for teams that always play in it. |
| Heat (> 90°F) | Marginal; slight edge to the better-conditioned / deeper team late. |

Rule: weather is a **totals input first**, a spread tiebreaker a distant second.
A calm 70°F forecast carries no signal — most games look like that.

### Injuries (`Injury` table, from ESPN's unofficial API)

We track **impact players only** — QBs at any status, other skill players and
premium defenders when they're Out or Doubtful. Backups and non-premium spots
are deliberately ignored (noise).

**Big caveat: ESPN's college-football injury data is thin and lags.** A quiet
injury report often means ESPN hasn't published, not that everyone's healthy.
Treat a listed injury as real signal; treat an empty report as "unknown," not
"clean." The one injury that always matters is a **starting QB ruled out** — that
can be worth 7–14 points and the market may be slow to fully adjust in-week.

---

## 5. Situational flags

Flags are **corroborating signals, never the prediction itself.** A flag on its
own is not a reason to bet. The way to use them: when the spread model already
shows an edge of 2.5+ points, a flag pointing the *same direction* is the second
independent signal the brief requires to call it a pick candidate.

They're computed per team per game and stored in `GameFlag`. Thresholds are
deliberately conservative — we'd rather miss a soft flag than raise a false one.

| Flag | Exact rule | What it tells you |
|---|---|---|
| **`short_week`** | Fewer than **6 days** since this team's previous game (e.g. a Saturday team playing the next Thursday/Friday). | Less practice and recovery time. Historically a small negative for the team on the short week, more so if they also traveled. |
| **`off_bye`** | A **skipped week** on the schedule — the team's previous game was two or more week-numbers ago (a true bye, not just the stretched-out Week 1 window). | Extra prep time. Usually a small *positive*, especially for the better-coached team and for underdogs who get a week to game-plan. |
| **`travel`** | This team's home stadium is **≥ 1,200 miles** from the game venue, **or** the body-clock timezone shift is **≥ 2 hours**. Detail carries the exact miles and hour shift. | Long trips and big time-zone jumps (especially West→East for a morning kick) are a documented small drag on the traveling team. |
| **`revenge`** | This team **lost the last meeting** (within the last 2 seasons), that loss was **a rivalry game or by ≤ 10 points** (a close one they let slip, not a blowout by a better team), **and** this year's game is projected within 14 points (close enough for motivation to matter). Detail carries the date and margin. | The "one that got away" angle. Real effect is modest and the market prices some of it — a tiebreaker, not a driver. |
| **`lookahead`** | This team is at least decent, favored by **≥ 13 points** (SP+ model) this week, **and** next week they play a rivalry game or a genuinely tough opponent (projected within ~6 points). | Classic trap: a good team with one eye on next week's big game can come out flat. **Fade this team / take the points.** |
| **`letdown`** | Last week this team **won** a game that was either a rivalry or against a team rated within 3 SP+ points (an emotional, "played up" win) **and** this week's opponent is rated **≥ 10 SP+ points weaker**. | Emotional hangover after a big win, against a team they may overlook. **Fade this team / take the points.** |

### Reading them

- **`lookahead` and `letdown` point at the same bet** (fade the favorite) and are
  the strongest of the six because they combine schedule spot *and* a mismatch.
- **`travel` + `short_week` on the same team** compound — that's a meaningfully
  tired team.
- **`off_bye` for the underdog** is the one flag that usually favors *backing* a
  side rather than fading one.
- A flag against a team the model *already* dislikes = green light for a candidate.
  A flag against a team the model *likes* = it cancels out; stand down.

---

## 6. How a pick is made

Most model disagreements never become picks. A game is logged in the `Pick`
table only when **all** of these hold:

**Spread pick**
1. `|edge| ≥ 2.5` points (model home margin vs. market home margin).
2. The market spread is **within 20 points** — no blowout favorites (§2).
3. A **second, independent signal agrees**:
   - SRS shows the same side, also ≥ 2.5 points (once SRS exists, ~week 3+), **or**
   - a situational flag points the same way — a "hurts" flag (`short_week`,
     `travel`, `lookahead`, `letdown`) on the team we're fading, or a "helps"
     flag (`off_bye`, `revenge`) on the team we're backing.

**Total pick**
1. `|edge| ≥ 3.5` points (totals are noisier — higher bar).
2. The game is **competitive** — market spread within 14 (§3).
3. A pace/weather signal agrees: fast projected pace for an OVER; slow pace or
   sustained wind ≥ 15 mph for an UNDER.

`method` on the pick says what corroborated it: `consensus` = both rating models,
`sp_plus` = SP+ plus a flag or pace signal. `flagsPresent` lists the specific
corroborators.

A pick is **logged once, the first time it qualifies**, with the model line,
market line, and edge frozen as of that moment. It is never rewritten — that's
what makes the grading honest.

Expect **few picks** — often 0–4 a week, sometimes zero. Early in the season
there are fewer still, because the SRS corroborator isn't available yet. That's
the design working, not a bug. A week with no picks means the model and the
market agreed everywhere that mattered.

---

## 7. Closing-line value (CLV) and grading

After the games, `grade-picks` fills in each pick's actual result and grades it
two ways:

**ATS (against the spread)** — did the pick win, lose, or push *against the number
we logged it at*? This is the bottom-line scoreboard, but it's noisy: a good
process goes through 3–4 win and 3–4 loss stretches by chance all the time. One
season of ATS record proves very little.

**CLV (closing-line value)** — how many points better our number was than the
**closing** line, from our side. Example: we logged Duke −9.5 and it closed
Duke −11 → **+1.5 CLV** (we'd have had to lay 11 at close; we got 9.5).

CLV is the number that actually matters. The closing line is the sharpest price
the market produces; if our picks **consistently beat it**, the process is
finding real value, *regardless of that season's win/loss variance*. Positive
average CLV with a break-even ATS record is a good sign. Negative CLV with a
winning record is probably luck. Watch the CLV.
