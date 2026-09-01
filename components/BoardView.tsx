"use client";

import { useMemo, useState } from "react";
import type { GameView } from "../lib/webData";
import { GameCard } from "./GameCard";

type Section = { label: string; games: GameView[] };

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
  const query = q.trim().toLowerCase();

  // flat, de-duped, kickoff-sorted list for search results
  const allGames = useMemo(() => {
    const seen = new Map<string, GameView>();
    for (const s of sections) for (const g of s.games) if (!seen.has(g.id)) seen.set(g.id, g);
    return [...seen.values()].sort(
      (a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)
    );
  }, [sections]);

  const results = useMemo(
    () => (query ? allGames.filter((g) => haystack(g).includes(query)) : []),
    [allGames, query]
  );

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

      {query ? (
        results.length > 0 ? (
          <section>
            {results.map((g) => (
              <GameCard key={g.id} g={g} />
            ))}
          </section>
        ) : (
          <p className="empty">No games match “{q.trim()}”.</p>
        )
      ) : (
        sections.map((s) => (
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
