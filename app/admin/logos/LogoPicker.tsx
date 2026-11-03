"use client";

import { useMemo, useState, useTransition } from "react";
import { setLogoPref } from "./actions";
import type { LogoChoice } from "../../../lib/teamLogo";

export type LogoTeam = {
  id: string;
  name: string;
  group: string;
  light: string | null;
  dark: string | null;
  choice: LogoChoice;
};

type Filter = "all" | "dark" | "light";

export function LogoPicker({ teams }: { teams: LogoTeam[] }) {
  const [choices, setChoices] = useState<Record<string, LogoChoice>>(() =>
    Object.fromEntries(teams.map((t) => [t.id, t.choice]))
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [, startTransition] = useTransition();

  const pick = (t: LogoTeam, choice: LogoChoice) => {
    const before = choices[t.id];
    if (before === choice) return;
    setChoices((c) => ({ ...c, [t.id]: choice })); // show it right away
    setFailed(null);
    startTransition(async () => {
      const res = await setLogoPref(t.id, choice).catch(() => ({ ok: false }));
      if (!res.ok) {
        setChoices((c) => ({ ...c, [t.id]: before })); // put it back
        setFailed(t.name);
      }
    });
  };

  const darkCount = Object.values(choices).filter((c) => c === "dark").length;

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const shown = teams.filter(
      (t) =>
        (!query || t.name.toLowerCase().includes(query)) &&
        (filter === "all" || choices[t.id] === filter)
    );
    const byGroup = new Map<string, LogoTeam[]>();
    for (const t of shown) {
      const list = byGroup.get(t.group) ?? [];
      list.push(t);
      byGroup.set(t.group, list);
    }
    // FBS conferences A-Z, the lower divisions last
    return [...byGroup.entries()].sort(([a], [b]) =>
      a.startsWith("FCS") ? 1 : b.startsWith("FCS") ? -1 : a.localeCompare(b)
    );
  }, [teams, q, filter, choices]);

  return (
    <div className="lp">
      <div className="lp-controls">
        <input
          className="lp-search"
          type="search"
          placeholder="Find a team…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="lp-filter" role="group" aria-label="Show">
          {(
            [
              ["all", `All ${teams.length}`],
              ["dark", `Dark ${darkCount}`],
              ["light", `Standard ${teams.length - darkCount}`],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              className={filter === f ? "on" : ""}
              onClick={() => setFilter(f)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {failed && <p className="lp-error">Couldn&apos;t save {failed}. Try again.</p>}

      {groups.length === 0 && <p className="empty">No teams match.</p>}
      {groups.map(([group, list]) => (
        <section key={group} className="lp-group">
          <div className="section-label">{group}</div>
          <div className="lp-grid">
            {list.map((t) => (
              <div key={t.id} className="lp-team">
                <div className="lp-name">{t.name}</div>
                <div className="lp-options">
                  {(["light", "dark"] as LogoChoice[]).map((c) => {
                    const src = c === "dark" ? t.dark : t.light;
                    const on = choices[t.id] === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`lp-option${on ? " on" : ""}`}
                        disabled={!src}
                        aria-pressed={on}
                        onClick={() => pick(t, c)}
                      >
                        {src ? (
                          <span className="lp-imgs">
                            {/* big to judge it, small at the board's real size */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt="" className="lp-big" loading="lazy" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt="" className="lp-small" loading="lazy" />
                          </span>
                        ) : (
                          <span className="lp-none">none</span>
                        )}
                        <span className="lp-label">{c === "dark" ? "Dark" : "Standard"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
