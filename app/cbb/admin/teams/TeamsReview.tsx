"use client";

import { useMemo, useState, useTransition } from "react";
import { confirmAlias, confirmAllSuggestions, rejectAlias } from "./actions";

type Alias = { id: string; source: string; alias: string; confidence: string };
export type ReviewTeam = {
  id: string;
  name: string;
  conference: string | null;
  d1: boolean;
  aliases: Alias[];
};
export type Unmatched = Record<string, { names: string[]; at: string } | undefined>;

const SOURCES: [string, string][] = [
  ["odds_api", "FanDuel"],
  ["kenpom", "KenPom"],
];

type Filter = "review" | "missing" | "all";

export function TeamsReview({ teams, unmatched }: { teams: ReviewTeam[]; unmatched: Unmatched }) {
  const [aliases, setAliases] = useState<Record<string, Alias[]>>(() =>
    Object.fromEntries(teams.map((t) => [t.id, t.aliases]))
  );
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("review");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const all = Object.values(aliases).flat();
  const reviewCount = all.filter((a) => a.confidence !== "confirmed" && a.source !== "espn" && a.source !== "cbbd").length;
  const missing = (t: ReviewTeam, src: string) => t.d1 && !aliases[t.id].some((a) => a.source === src);
  const missingCount = teams.filter((t) => SOURCES.some(([s]) => missing(t, s))).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return teams.filter((t) => {
      const as = aliases[t.id];
      if (needle && !t.name.toLowerCase().includes(needle) && !as.some((a) => a.alias.toLowerCase().includes(needle)))
        return false;
      if (filter === "review") return as.some((a) => a.confidence !== "confirmed" && SOURCES.some(([s]) => s === a.source));
      if (filter === "missing") return SOURCES.some(([s]) => missing(t, s));
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, aliases, q, filter]);

  const patch = (teamId: string, fn: (as: Alias[]) => Alias[]) =>
    setAliases((cur) => ({ ...cur, [teamId]: fn(cur[teamId]) }));

  const confirm = (teamId: string, a: Alias) =>
    start(async () => {
      const r = await confirmAlias(a.id).catch(() => ({ ok: false }));
      if (r.ok) patch(teamId, (as) => as.map((x) => (x.id === a.id ? { ...x, confidence: "confirmed" } : x)));
      else setMsg("Couldn't save — are you still signed in?");
    });

  const reject = (teamId: string, a: Alias) => {
    if (!window.confirm(`Reject "${a.alias}" for ${teams.find((t) => t.id === teamId)?.name}?`)) return;
    start(async () => {
      const r = await rejectAlias(a.id).catch(() => ({ ok: false }));
      if (r.ok) patch(teamId, (as) => as.filter((x) => x.id !== a.id));
      else setMsg("Couldn't save — are you still signed in?");
    });
  };

  const confirmEverything = () => {
    if (!window.confirm(`Confirm all ${reviewCount} suggestions?`)) return;
    start(async () => {
      const r = await confirmAllSuggestions().catch(() => ({ ok: false, count: 0 }));
      if (!r.ok) return setMsg("Couldn't save — are you still signed in?");
      setAliases((cur) =>
        Object.fromEntries(
          Object.entries(cur).map(([k, as]) => [k, as.map((a) => ({ ...a, confidence: "confirmed" }))])
        )
      );
      setMsg(`Confirmed ${r.count ?? 0}.`);
    });
  };

  const unmatchedList = SOURCES.flatMap(([s, label]) => (unmatched[s]?.names ?? []).map((n) => ({ label, n })));

  return (
    <div className="cbbt">
      <div className={`cbbt-unmatched ${unmatchedList.length ? "bad" : "good"}`}>
        {unmatchedList.length === 0 ? (
          <>✓ No unmatched names from the latest run.</>
        ) : (
          <>
            <strong>{unmatchedList.length} unmatched name{unmatchedList.length === 1 ? "" : "s"}</strong> — add each
            to <code>data/cbb/manualAliases.json</code>:
            <ul>
              {unmatchedList.map((u) => (
                <li key={u.label + u.n}>
                  <span className="cbbt-src">{u.label}</span> {u.n}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="cbbt-bar">
        <input
          className="cbbt-search"
          placeholder="Search a team or spelling…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="cbbt-filters">
          {(
            [
              ["review", `To review (${reviewCount})`],
              ["missing", `Missing a source (${missingCount})`],
              ["all", `All (${teams.length})`],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} className={`cbbt-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
        {reviewCount > 0 && (
          <button className="admin-btn" disabled={pending} onClick={confirmEverything}>
            Confirm all {reviewCount}
          </button>
        )}
      </div>
      {msg && <p className="cbbt-msg">{msg}</p>}
      <p className="cbbt-note">
        &ldquo;Missing a source&rdquo; is normal for FanDuel: it only lists teams with upcoming games, so it fills in
        over the season.
      </p>

      <div className="cbbt-list">
        {shown.length === 0 && <p className="cbbt-empty">Nothing here.</p>}
        {shown.map((t) => (
          <div key={t.id} className="cbbt-row">
            <div className="cbbt-team">
              <span className="cbbt-name">{t.name}</span>
              <span className="cbbt-conf">{t.d1 ? t.conference : "non-D-I"}</span>
            </div>
            {SOURCES.map(([src, label]) => {
              const as = aliases[t.id].filter((a) => a.source === src);
              return (
                <div key={src} className="cbbt-cell">
                  <span className="cbbt-src">{label}</span>
                  {as.length === 0 && <span className="cbbt-none">{t.d1 ? "—" : ""}</span>}
                  {as.map((a) => (
                    <span key={a.id} className={`cbbt-alias ${a.confidence === "confirmed" ? "ok" : "rev"}`}>
                      {a.alias}
                      {a.confidence !== "confirmed" && (
                        <>
                          <button title="Confirm" disabled={pending} onClick={() => confirm(t.id, a)}>
                            ✓
                          </button>
                          <button title="Reject" disabled={pending} onClick={() => reject(t.id, a)}>
                            ✕
                          </button>
                        </>
                      )}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
