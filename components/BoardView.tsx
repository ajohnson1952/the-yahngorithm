"use client";

import { useMemo, useState } from "react";
import type { GameView } from "../lib/webData";
import { GameCard } from "./GameCard";
import { FLAG_LABEL } from "./ui";

type Section = { label: string; games: GameView[] };

// every flag the board can filter by, in display order:
// situational → market → weather. Short chip labels (the card / guide use
// the longer FLAG_LABEL). Only flags with games this week actually render.
const FILTER_FLAGS: { flag: string; label: string }[] = [
  { flag: "bad_spot", label: "bad spot" },
  { flag: "travel", label: "travel" },
  { flag: "revenge", label: "revenge" },
  { flag: "lookahead", label: "lookahead" },
  { flag: "letdown", label: "letdown" },
  { flag: "short_week", label: "short week" },
  { flag: "off_bye", label: "off bye" },
  { flag: "steam", label: "steam" },
  { flag: "rlm", label: "reverse line" },
  { flag: "heat", label: "heat" },
  { flag: "cold", label: "cold" },
  { flag: "wind", label: "wind" },
  { flag: "rain", label: "rain" },
  { flag: "snow", label: "snow" },
];

function haystack(g: GameView): string {
  return [
    g.home.name,
    g.home.abbr,
    g.home.conference,
    g.away.name,
    g.away.abbr,
    g.away.conference,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function BoardView({ sections }: { sections: Section[] }) {
  const [q, setQ] = useState("");
  const [flag, setFlag] = useState<string | null>(null);
  const query = q.trim().toLowerCase();

  // flat, de-duped, kickoff-sorted list — used for search and the flag filter
  const allGames = useMemo(() => {
    const seen = new Map<string, GameView>();
    for (const s of sections) for (const g of s.games) if (!seen.has(g.id)) seen.set(g.id, g);
    return [...seen.values()].sort(
      (a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)
    );
  }, [sections]);

  // only offer chips for flags that actually have games this week
  const flagChips = useMemo(
    () =>
      FILTER_FLAGS.map(({ flag: ft, label }) => ({
        flag: ft,
        label: label.replace(/^./, (c) => c.toUpperCase()),
        count: allGames.filter((g) => g.flags.some((f) => f.flagType === ft)).length,
      })).filter((c) => c.count > 0),
    [allGames]
  );

  const hasFlag = (g: GameView) =>
    !flag || g.flags.some((f) => f.flagType === flag);

  const results = useMemo(
    () =>
      query ? allGames.filter((g) => haystack(g).includes(query) && hasFlag(g)) : [],
    [allGames, query, flag]
  );

  // flag filter collapses the day/edge grouping into one kickoff-sorted list
  const shownSections = useMemo<Section[]>(() => {
    if (!flag) return sections;
    const games = allGames.filter(hasFlag);
    return games.length
      ? [
          {
            label: `${FLAG_LABEL[flag] ?? flag} — ${games.length} game${games.length === 1 ? "" : "s"}`,
            games,
          },
        ]
      : [];
  }, [sections, allGames, flag]);

  return (
    <>
      <div className="board-search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search team name or abbreviation…"
          aria-label="Search games by team"
          autoComplete="off"
        />
        {query && (
          <span className="board-search-count">
            {results.length} match{results.length === 1 ? "" : "es"}
            <button type="button" onClick={() => setQ("")}>clear</button>
          </span>
        )}
      </div>

      {flagChips.length > 0 && (
        <div className="flag-filter">
          <span className="flag-filter-label">flag</span>
          {flagChips.map((c) => (
            <button
              key={c.flag}
              type="button"
              className={flag === c.flag ? "on" : ""}
              aria-pressed={flag === c.flag}
              onClick={() => setFlag(flag === c.flag ? null : c.flag)}
            >
              {c.label} <span className="n">{c.count}</span>
            </button>
          ))}
          {flag && (
            <button
              type="button"
              className="flag-filter-clear"
              onClick={() => setFlag(null)}
            >
              clear
            </button>
          )}
        </div>
      )}

      {query ? (
        results.length > 0 ? (
          <section>
            {results.map((g) => (
              <GameCard key={g.id} g={g} />
            ))}
          </section>
        ) : (
          <p className="empty">
            No games match “{q.trim()}”
            {flag ? ` with a ${FLAG_LABEL[flag] ?? flag} flag` : ""}.
          </p>
        )
      ) : (
        shownSections.map((s) => (
          <section key={s.label}>
            <div className="section-label">{s.label}</div>
            {s.games.map((g) => (
              <GameCard key={g.id} g={g} />
            ))}
          </section>
        ))
      )}
    </>
  );
}
