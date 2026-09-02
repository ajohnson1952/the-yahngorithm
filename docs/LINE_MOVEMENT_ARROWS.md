# Line-movement arrows — getting the direction right

**Portable note.** This bug bit the-yahngorithm and the same trap exists in
Cavepicks (any UI that shows a ▲/▼ chip for how a point spread has moved). The
fix is a one-liner; the reasoning is below so it can be re-derived, not just
copy-pasted.

## The problem

You want a small chip on each game card: **which way has the spread moved since
it opened, and by how many points.** The obvious implementation:

```ts
const move = now - open;          // signed home spread, negative = home favored
// move > 0 → ▲ green,  move < 0 → ▼ red,  show |move|
```

This is **wrong for favorites**. Example: Duke opens `-9.5`, drifts to `-7.5`.

- `now - open = -7.5 - (-9.5) = +2` → the code shows **▲ green +2**.
- But the line got *smaller* — Duke went from a 9.5-point favorite to a
  7.5-point favorite. To anyone reading a board it moved **down**, toward
  pick'em. It should be **▼ red 2**.

Underdog lines (`+3 → +5`) look fine only by luck: their sign already matches
their magnitude, so `now - open` happens to point the right way.

## The mental model that works

A bettor doesn't read a spread as a signed number on a line through zero. They
read it as **a size**: "a 7-point favorite," "a 3-point dog." Pick'em (0) is the
floor. So the arrow should answer:

> Did the line get **bigger** (further from pick'em) or **smaller** (closer to
> pick'em)?

- bigger favorite **or** bigger underdog → ▲ (green)
- either one moving toward pick'em → ▼ (red)

That's `|now| − |open|` for the **direction**.

## But `|now| − |open|` alone loses points on a crossing

If the line crosses pick'em — opens `-1` (home favored), now `+2` (home is a
2-point dog) — the raw move is **3 points**, but `|now| − |open| = 2 − 1 = 1`.
The direction is right (line ended bigger, ▲) but the number is understated.

Worse, an **exact-magnitude flip** (`-2 → +2`) gives `|now| − |open| = 0`, so a
`Math.sign()` of it is `0` and the chip **disappears** even though the line
moved 4 points and swapped which team is favored. In this project's data that's
**~0.8% of games (6–8 per season, trending up)** — rare but not never, and
always on the coin-flip games that are the most interesting.

## The fix

Take the **direction** from `|now| − |open|` and the **magnitude** from the raw
`|now − open|`. Break the exact-flip tie toward ▲ (green) rather than nothing —
green there is arbitrary (the line is the same size, other team's favored now),
but "▲4, opened X -2" reads fine and beats a vanishing chip.

```ts
/** Signed points a spread has moved, oriented by distance from pick'em.
 *  + = line grew (bigger favorite/dog, ▲ green)
 *  − = line shrank toward pick'em (▼ red)
 *  Magnitude is always the real points moved, including across pick'em. */
function spreadMove(now: number, open: number): number {
  const grew = Math.abs(now) - Math.abs(open) >= 0 ? 1 : -1;
  return round1(grew * Math.abs(now - open));
}
```

Render: `move > 0` → ▲ green, `move < 0` → ▼ red, label `|move|`; hide when
`|move| < 0.5` (sub-half-point noise).

### Verified behaviour

| open → now | result | why |
|---|---|---|
| `-9.5 → -7.5` | ▼ red 2 | favorite shrank |
| `-7.5 → -9.5` | ▲ green 2 | favorite grew |
| `+14 → +13.5` | ▼ red 0.5 | dog shrank |
| `+1.5 → +2` | ▲ green 0.5 | dog grew |
| `-1 → +2` | ▲ green 3 | crossed, ended bigger — full 3 pts |
| `-2 → +1` | ▼ red 3 | crossed, ended smaller — full 3 pts |
| `-2 → +2` | ▲ green 4 | exact flip — full 4 pts, no vanished chip |

Checked against 3,356 historical games that moved ≥ 0.5 pts: **0** now render
as an empty chip.

## Totals don't have this problem

A total is always a positive number nowhere near zero, so `now − open` is already
the right signed move (`53 → 50` = ▼ 3). No `Math.abs` needed. Only the spread
chip needs the treatment above.

## Applying to Cavepicks

Same one function. Wherever Cavepicks computes spread movement for its arrows,
replace `now - open` with `spreadMove(now, open)` above and key the arrow/colour
off its sign. The totals arrow (if any) stays as a plain `now - open`.
