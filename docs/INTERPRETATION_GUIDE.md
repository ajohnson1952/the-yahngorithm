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

## 1. The three spread models: SP+, SRS, and Yahn

We run **three independent power-rating spread models** on every game and store all
three (`predictedSpreadSpPlus`, `predictedSpreadSrs`, `predictedSpreadYahn`).

| | SP+ | SRS | Yahn |
|---|---|---|---|
| Source | CFBD `/ratings/sp` (+ Bill C sheet for FCS) | CFBD `/ratings/srs` | SP+ backbone + EPA + roster + per-team HFA |
| What it measures | Opponent-adjusted **play-by-play efficiency** | Opponent-adjusted **scoring margin** | SP+ **adjusted** by raw efficiency and roster construction |
| Built to | Predict future performance | Describe what happened | Catch what a single-number preseason rating misses early |
| Coverage | FBS + FCS | FBS + most FCS (once games are played) | FBS (falls back to plain SP+ where a factor is missing) |
| Offense/defense split | Yes (feeds the totals model too) | No | No — spread only |

SP+ and SRS are on the same scale ("points better than an average team"):

```
predicted_margin = home_rating - away_rating + 2.5 home-field
```

### The Yahn model

Yahn keeps **SP+ as the backbone** and layers on two bounded, time-decaying
adjustments, then uses a **per-team home-field number** instead of the flat 2.5:

- **EPA adjustment** — nudges the rating toward the team's raw expected-points-added
  per play. Near zero in September (small samples are schedule noise); its weight
  grows through the season.
- **Roster adjustment** — where the roster disagrees with SP+: 247 talent composite,
  returning production (continuity), and net transfer-portal value. Biggest in the
  preseason, fades to zero by about week 5 as real results pile up.
- **Per-team HFA** — a **2.7-pt base**, plus the larger of two bumps (they don't
  stack):
  - **altitude** — up to ~+1 for Wyoming / Air Force, ~+0.4–0.5 for Colorado / the
    Mountain West / BYU / Utah. Data-supported.
  - **hostile venue** — a small hand-set list of famous cauldrons: +0.40 for
    LSU / Texas A&M / Penn State / Oregon; +0.25 for Ohio State / Georgia / Alabama /
    Tennessee / Clemson / Florida / Auburn / Wisconsin / Oklahoma; +0.15 for Virginia
    Tech / Texas / South Carolina / West Virginia / Iowa / Washington / Notre Dame /
    Mississippi State / Ole Miss / Michigan.

  Deriving a venue number for *all* 133 teams from seven years of results didn't work —
  at that sample size the estimate just measures "favorites don't cover the number,"
  and the home team is nearly always the favorite. (SP+ and SRS keep a flat 2.5.)

The game page shows the full breakdown (SP+ base, EPA adj, roster adj, HFA) for each
team. Where Yahn and SP+ disagree by more than ~2 pts, it's the roster/efficiency
picture pulling against the preseason number — look at why.

> **What the backtest found (see `docs/CALIBRATION.md`).** A walk-forward test over
> 2023–25 (~2,200 games) says Yahn — heuristic *or* with fitted weights — **does not
> beat the closing line** (49–51.5% ATS, break-even 52.4%). The talent / returning /
> portal factors are already priced in by the market; only EPA/play carries a small
> residual signal, too small to act on. Yahn is **not worse** than a plain rating.
> **So: read Yahn as a third opinion and a breakdown of *why* a team rates where it
> does — not as a betting signal.** It does not feed pick generation.

The old **"My Top 25"** eye-test tool (`/rankings`) is **parked** — it's off the
nav and doesn't feed anything. The calibration work didn't turn up an edge that
would justify hand-weighting a ranking into the model.

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

**The "market" number is a real, bettable line — not an average.** Books rarely
all post the same spread, so the site shows the number the **most books are
actually posting** (the mode), not the median across books. The median can land
between books — a "median total" of 58.3 is not a line you could bet, and
showing it made picks read like *"Over 58.3."* The model's own prediction stays
exact; only the market side snaps to a number a book really offers.

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
combined points at avg pace = (home_off + away_def)/2 + (away_off + home_def)/2
expected possessions        = home pace + away pace   (drives/game, ~11.6 each)
                              blended: prior season early, current season as it accrues
predicted total = combined points × (possessions / league-average) − wind adj
```

### The total and the spread agree

The offense/defense split is only good at estimating the **combined** total —
not the margin. So the margin comes from the **spread model** (SP+), and the
total is split around it:

```
home expected points = (total + spread margin) / 2
away expected points = (total − spread margin) / 2
```

That means the per-team scores on a game page always add up to the total **and**
differ by exactly the spread. If the spread says home −7.5, the projected score
is 7.5 apart.

**Caveat for big favorites:** the split assumes the favorite scores exactly its
share. In reality a big favorite's real margin is a touch less than its raw
rating edge (starters rest, clock runs, garbage time feeds the dog) — the same
reason books shade favorites down (§2). On lopsided games the underdog's score
is floored at ~7 and the implied margin compresses a bit, which is the right
direction. Trust the per-team scores most on competitive games.

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
Stored: temperature + "feels like", humidity, wind (sustained + gust),
precipitation probability, and rain / snowfall rate at kickoff. When a forecast
is genuinely extreme it also raises a **weather chip** on the game — see §5.

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
| **`bad_spot`** | **Two or more** of `travel` / `lookahead` / `letdown` / `short_week` stacked on the same team (e.g. a long trip on a short week). A rollup — the red chip. | The genuinely nasty spots — ~1 per week. Backtests ~57% ATS on the fade (small sample). **Take the points against this team.** Filter the board to these with the `bad spot` flag chip. Does *not* corroborate picks (its components already do). |

### The other chips you'll see on a card

Not every chip is a situational flag. A card can also show:

| Chip | Colour | Source | What it means |
|---|---|---|---|
| **`steam`** | amber (help) | market (§9) | The consensus spread made a fast, synchronized move toward this team across books — real money came in on them quickly. |
| **`reverse line move`** (`rlm`) | red (hurt) | market (§9) | In the last ~30 h the book's number moved toward this team while the Kalshi market (real money, no vig) didn't follow. Looks like public money, not a real shift — **lean the other side.** |
| **`fast pace`** (`fast_pace`) | blue | totals model | The game projects to **≥ 26 possessions** — an up-tempo matchup. Shown when it's the second signal behind an **OVER** pick. |
| **`slow pace`** (`slow_pace`) | blue | totals model | The game projects to **≤ 21 possessions** — a grind. Shown when it's the second signal behind an **UNDER** pick. |

The blue chips are **totals corroboration only** — they never touch a spread pick, and on their own they are not a reason to bet. `steam` / `rlm` get their full treatment in §9.

### Weather chips

Raised when the **kickoff forecast is genuinely extreme for football** — a handful of games a week in the hot early season and the cold late one, near-zero in between. They hit **both teams**, so they're a "conditions" heads-up, not a fade-this-team signal. Weather is already baked into the totals model (§3–4); these chips just make the notable games easy to spot. **Not pick corroborators, not graded.**

| Chip | Fires when | Football effect |
|---|---|---|
| **`extreme heat`** (`heat`) | "feels like" (heat index) **≥ 100°F** at kickoff | Late-game legs and depth matter more; offenses stall in the 4th. Small **UNDER** lean. |
| **`extreme cold`** (`cold`) | "feels like" (wind chill) **≤ 15°F** | Catching and kicking get hard, FG range shrinks → **UNDER** + the run, and the cold-weather side over a warm-weather visitor. |
| **`wind`** | sustained **≥ 20 mph** or gusts **≥ 35** | The biggest weather factor — passing and kicking suffer badly. Strong **UNDER** lean; shootout scripts are unlikely. |
| **`heavy rain`** (`rain`) | steady rain **≥ 3 mm/hr** and above freezing | Fumbles up, passing down → the run, the more physical team, and the **UNDER**. |
| **`snow`** | snow falling **≥ 0.5 cm/hr**, or near-freezing with a high precip chance | Highest-variance weather: heavy **UNDER** pressure, kicking chaos, ball-security problems. Often the points with the dog. |

### Reading them

- A flag against a team the model *already* dislikes = green light for a candidate.
  A flag against a team the model *likes* = it cancels out; stand down.

> **What the backtest found (2021–25, `docs/CALIBRATION.md`).** Betting a flag's
> implied side vs the close:
> - **`travel`** is the best single flag — **54.8%** ATS (n=425).
> - The **"fade" flags together** (`travel` / `lookahead` / `letdown`) run **~53%**,
>   but that's flat in 2021–22 and only shows up in 2023–25 — a weak, unstable lean.
> - The **"help" flags** (`off_bye`, `revenge` as a straight bet) show **nothing** (~51%).
> - As *corroboration* for a rating edge, **`travel` (60%) and `revenge` (56%)** carry
>   the signal; **`short_week` corroboration is counterproductive (39%)** and `off_bye`
>   is dead.
>
> Net: `travel` (and to a lesser extent `revenge`, `letdown`, `lookahead`) is worth
> respecting as a lean. `short_week` and `off_bye` are not — and `short_week` should
> probably be dropped as a corroborator.

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
what makes the grading honest. The market line it's frozen at is a **real number
a book was posting** at that moment (§2), so it stays gradeable against a real
closing line later.

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

### The Grades page

`/grades` is the wider version of the same idea: **every** spread model (SP+,
SRS, Yahn) and **every** flag, graded against the closing line on **every** final
game — not just the games that became logged picks. Each row is a season-to-date
ATS record and win %, with 52.4% as the break-even mark.

This is the honest, hindsight-free scoreboard for the whole tool. The backtests
(`CALIBRATION.md`) say to expect everything to hover around 50% — the Grades page
is where we find out if the live 2026 season agrees. Small samples early; one
week is noise. Look at where things sit by mid-season on 100+ games.

---

## 8. Team trends (ATS / SU / O-U splits)

On each game page, current season to date, for both teams:

| Split | What it is |
|---|---|
| **ATS overall** | record against the closing spread |
| **ATS at home / on the road** | same, split by venue |
| **ATS as favorite / as underdog** | same, split by which side of the number they were |
| **ATS after a win / after a loss** | the next game's ATS result, bucketed by the previous game's straight-up result — the "bounce-back / letdown" angle in raw form |
| **W–L at home / on the road** | straight-up record by venue (not ATS) |
| **Over / Under** | how often the game's total went over vs under the closing number |

**Amber = an outlier**: a split where the team is **≥ 65% or ≤ 35% ATS with at
least 8 games**. Anything short of that is just noise and isn't highlighted.

How to use them: **context, not a signal.** A team that's 9–3 ATS as a favorite
tells you the market has been slow to catch up to them — worth knowing when the
model also likes that side. It is not a reason to bet on its own, and ATS
records regress hard: last year's 10–3 ATS team is a coin flip this year. Treat
an outlier the same way you'd treat a situational flag — a tiebreaker that adds
confidence when it points the same way as the model, nothing when it doesn't.

Early in the season every split reads "–" until a team has played enough games.

---

## 9. Market flags: reverse line movement and steam

Two flags come from the betting market itself, not the schedule. They show
as **purple chips**.

### `steam`

The consensus spread made a **fast, synchronized move** toward one team —
≥ 1.5 points across most books within a few hours. That's the fingerprint of
real money hitting the market quickly (a syndicate, a respected source). It
fires on the team the line moved *toward*. Following steam late is usually a
losing play — the value's already gone — but it tells you which side the
sharp money is on, which is useful as a corroborator or a "don't fade this"
signal.

`pull-lines` snapshots the board every ~2.75 h during game windows (every 25 min
in the Saturday 9a–8p core), which is enough to see these moves — `steam` and
`rlm` both fire in a normal week. The one gap: a fast move that starts *and*
finishes inside a single 2.75 h window on a Thursday or Friday can be missed.

> **Backtest note.** Using open→close as a stand-in for line movement,
> **neither following nor fading the move beats the close** (49.5% / 50.5%,
> n=2,077). By definition the closing number already contains the move — the
> only value in "steam" is catching it *before* the close. Treat `steam` as a
> "which side is the sharp money on / don't fade this" signal, not a bet trigger.

### `rlm` (reverse line movement)

**Within the last ~30 hours**, the sportsbook's number moved **toward** one team
while the **Kalshi prediction market** (real money, no vig, CFTC-regulated)
*didn't move with it* — on a market with real volume (≥ 500 contracts).

The read: the line drifting toward this team looks like public money, not new
information — the sharp, no-vig market isn't re-rating the game. **Lean the
other side.** The flag fires on the team the book moved *toward* (the one to fade).

The window matters: a line that settled 2 points off a soft opener on Tuesday
and then held is **not** `rlm` — that's price discovery, and by Friday it's old
news. `rlm` only fires while the divergence is *live*. (A standing book-vs-Kalshi
gap that isn't moving is a different idea — a "fair-value gap" — not yet built.)

Kalshi's win-probability is converted to an implied spread with a normal model
(σ ≈ 13.5, the historical SD of a CFB result); we compare *movement over the
window*, not exact numbers, so the conversion doesn't need to be perfect.

### Reading the Kalshi panel on a game page

- **Win probability** (per team) — the market's price that that team wins,
  de-vigged so the two sides sum to 100%. This is the number that matters. The
  ▲/▼ next to the home team is how much it's moved since the previous snapshot.
- **Implied line** — that probability turned into a spread, shown next to the
  book's number. A gap of a point or two is noise; a bigger gap means the
  market and the book genuinely disagree about who's better.
- **Volume / Open interest / 24h** — these are **total contracts on the whole
  game**, not a per-side split. Kalshi runs a separate "Team A wins" and "Team B
  wins" market and you can back a side from either one, so the per-market
  volumes are *not* "money on A vs money on B" — don't read them that way. What
  they tell you is **how much to trust the price**: a market with 20,000+
  contracts is a real signal; one under 500 is two people and a bot — the panel
  flags those as thin.

**Both flags are corroborators, not the pick.** `rlm` against a team the model
already dislikes, or `steam` toward a team the model likes, is a green light.
Pointing the other way, they cancel — stand down.

---

## 10. When the data refreshes

Everything runs automatically. A scheduler ("the tick") fires every ~30 minutes,
checks the clock and how stale each source is, and refreshes what's due. Times
below are US Central. Full detail is in `docs/OPERATIONS.md`.

| When | What updates |
|---|---|
| **Every ~30 min, all week** | Kalshi, market flags, model + picks re-run |
| **Game windows** (all week except Tue) | **Live scores** + **grading** — a final is graded within ~30 min. **Line snapshots** every ~30 min in the Saturday 9a–8p core, every ~2–3 h otherwise. A game's last snapshot **before kickoff** is its closing line — we stop recording once it starts (the book's live in-game price is not a market line). |
| **Tuesday ~9am** | grade last week, then ratings / polls / schedule / advanced stats + EPA / **opening lines** / Kalshi / situational flags / model / picks |
| **Sunday ~10am** | advanced-stat checkpoint, team trends |
| **~6am & ~4pm** | Weather forecast, injury report |
| **Preseason (manual)** | Talent composite, returning production, transfer portal, per-team HFA |

Opening numbers land Tuesday; lines, scores and grades then refresh through
every game window. A pick is only ever logged **before kickoff**, and a game is
graded **as soon as it's final** — the **Grades** page is current within the hour
on a Saturday.

**One caveat on freshness:** the pages cache their database results for a short
window — about **2 minutes** for the board and game pages, **10–15 minutes** for
`/grades` and `/picks` (they only change after a final). So a hard refresh
right after a score changes may show the old number for a beat. The `/admin`
freshness panel is **never cached** — it's the ground truth for "did the
pipeline actually run?"

The line-snapshot cadence is sized to stay inside The Odds API's 500-credit
monthly budget even in a five-Saturday peak month — October 2026 is the worst
case (5 Thursdays + 5 Fridays + 5 Saturdays) and lands around 92%, with every
Saturday including the 31st fully covered. `pull-lines` also carries a hard
backstop that stops calling the API once the month's remaining credits fall
below 15, as protection against manual runs or an unusual bowl stretch. The
`/admin` panel shows the live balance.

### Using the board

- **View toggle** — *By kickoff* (grouped by day — the default), *By edge* (the
  model's disagreement groups, sub-sorted by kickoff), *★ Pinned* (your watch
  list).
- **Flag filter** — the chip row below the search box. Tap any flag —
  situational (`bad spot`, `travel`, `revenge`, `lookahead`, `letdown`,
  `short week`, `off bye`), market (`steam`, `reverse line`), or weather
  (`heat`, `cold`, `wind`, `rain`, `snow`) — to show only games where a team
  carries it; the number on each chip is how many games this week. Only flags
  with games appear. Tap again or hit *clear* to reset. Works with the search
  box (search within the filtered set).
- **Pin** a game with the star on its card or page to add it to the Pinned
  view. Pins are remembered per browser (an anonymous cookie — no login), so
  everyone keeps their own watch list.
- **Line-movement arrow** — the small **▲ / ▼ + points** next to a card's spread
  or total is how far that number has moved from the **first line we recorded**
  for the game (the opening number, or the earliest live pull we have). Hover it
  for what it opened at. Hidden when the move is under half a point.
  - **Spread** — measured on the line's **distance from pick'em**, not its sign.
    **▲ green** = the line *grew* (a bigger favorite): `Duke -7.5 → -9.5`, or a
    dog `+7.5 → +9.5`. **▼ red** = it *shrank toward pick'em*: `Duke -9.5 → -7.5`.
    So both sides of the number behave the same way — bigger is up, smaller is down.
  - **Total** — plain: **▲** the total went up, **▼** it came down.
  - It's *context*, not a signal — a big move tells you the market has an
    opinion, not which way to bet (§9 covers `steam` / `rlm`, which read the move).
- **Completed games** drop to a "Final" section at the bottom of every view.
- Each game page has a **Current lines** table — every book's latest number and
  odds, with the best price for each side flagged, for line-shopping — plus a
  full snapshot-by-snapshot line-movement history.

---

## 11. The watch guide (`/watch`)

A different kind of tool — not decision support for betting, but a plan for
which games to actually put on a quadbox for a day of watching. It slices the
day into windows ("11:00 AM CT," "3:15 PM CT," …) and shows the **4 best
games live in that window**, ranked by a 0–100 **watchability score**:

| Signal | Weight | What it rewards |
|---|---|---|
| Projected competitiveness | 40% | a market spread near pick'em |
| Ranked-team stakes | 30% | an AP-ranked team, more for two |
| Projected pace | 15% | a high total (shootout potential) |
| Rivalry | 15% | a known rivalry matchup (flat bonus) |

FBS-vs-FCS games are capped low regardless (almost always lopsided). A huge
market spread (24+ pts) gets flagged **"likely blowout"** even if it still
cracks a weak window — the reasons chip on each card always says *why* it's
there.

A window only changes when the actual top-4 changes — a game starting or
ending elsewhere doesn't reshuffle the board on its own. It assumes a fixed
~3h40m game length and clusters kickoffs within 45 minutes into one window,
so it's an estimate, not a live feed. **It's built from pregame data and does
not react to how a game is actually playing** — it won't notice a projected
blowout turn into a nailbiter, or vice versa. Plan your day with it in the
morning; it isn't a live re-optimizer.

---

## Glossary

| Term | Meaning |
|---|---|
| **ATS** | Against the spread. A bet/record measured against the point spread, not who won outright. |
| **SU** | Straight up. Who won the game, ignoring the spread. |
| **O/U** | Over/under — the total points line. |
| **push** | A tie against the number — the bet neither wins nor loses. Shown as the third figure in a record (6–2–**1**). |
| **cover** | A side "covers" when it beats the spread (a −7 favorite that wins by 10 covers; by 3 does not). |
| **break-even (52.4%)** | The win rate you need at standard −110 odds just to not lose money (risk 110 to win 100). |
| **edge** | Predicted margin − market margin, in points. How far the model disagrees with the line. The market side is the most-posted real book number (§2), not an average. |
| **line movement** | How far a spread or total has moved from the first number we recorded to now. Shown as a ▲/▼ chip on each card; the full history is on the game page. |
| **MAE** | Mean absolute error — the average size of the miss between a predicted margin and the actual result. Lower = more accurate. The Grades page shows each model's MAE next to the **closing line's own MAE** on the same games (~12 points over a full season) — green means the model out-predicted the market. Note: beating the market on MAE is *not* the same as beating it ATS. |
| **CLV** | Closing-line value — how many points better your number was than the closing line, from your side. The single best indicator that a process is finding value. |
| **the close / closing line** | The final line right before kickoff — the sharpest price the market makes. Everything here is graded against it. |
| **SP+** | Bill Connelly's tempo- and opponent-adjusted efficiency rating (points better than average). Predictive. |
| **SRS** | Simple Rating System — opponent-adjusted average scoring margin. Descriptive; empty until ~week 3. |
| **EPA** | Expected points added (per play) — how much each play changed the team's expected points. A raw efficiency measure. |
| **PPA** | CFBD's name for EPA (predicted points added). Same thing. |
| **HFA** | Home-field advantage, in points. Flat 2.5 for SP+/SRS; per-venue (2.7 + altitude/hostile bump) for Yahn. |
| **HFA base / altitude / hostile** | The three parts of the Yahn per-team home number (see §1). |
| **RLM** | Reverse line movement — the book's number moves toward the side the *public* is betting while the sharp signal points the other way. |
| **steam** | A fast, synchronized line move across books — the fingerprint of sharp money hitting quickly. |
| **talent composite** | The 247Sports team talent number — accumulated recruiting rankings, a proxy for raw roster ability. |
| **returning production** | The share of last year's output (measured in EPA) that's back this season — a continuity/experience measure. |
| **portal net** | Transfer-portal value in minus value out, per team — captures roster churn the preseason ratings underweight. |
