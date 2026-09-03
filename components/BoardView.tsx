"use client";

import { useMemo, useState } from "react";
import type { GameView } from "../lib/webData";
import { GameCard } from "./GameCard";
import { FLAG_LABEL } from "./ui";

type Section = { label: string; games: GameView[] };

// situational-flag filter chips, in display order (rollup, then the rest)
const SITUATIONAL = [
  "bad_spot",
  "travel",
  "revenge",
  "lookahead",
  "letdown",
  "short_week",
  "off_bye",
] as const;

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
      SITUATIONAL.map((ft) => ({
        flag: ft as string,
        label: (FLAG_LABEL[ft] ?? ft).replace(/^./, (c) => c.toUpperCase()),
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
