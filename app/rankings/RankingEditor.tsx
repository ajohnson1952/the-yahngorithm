"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { YAHN_TIERS, tierOf, YAHN_MAX_RANK } from "../../lib/yahn";
import { saveRanking } from "./actions";
import type { TeamOpt } from "./page";

function Logo({ t }: { t: TeamOpt }) {
  return t.logo ? (
    <img className="rk-logo" src={t.logo} alt="" loading="lazy" />
  ) : (
    <span className="rk-logo" style={{ background: "var(--border)" }} />
  );
}

function SortableRow({
  t,
  rank,
  rating,
  onRemove,
}: {
  t: TeamOpt;
  rank: number;
  rating: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: t.id });
  return (
    <li
      ref={setNodeRef}
      className={`rk-row${isDragging ? " rk-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="rk-grip" {...attributes} {...listeners} title="drag">
        ⠿
      </span>
      <span className="rk-rank">{rank}</span>
      <Logo t={t} />
      <span className="rk-name">{t.name}</span>
      <span className="rk-rating mono">+{rating.toFixed(1)}</span>
      <button className="rk-x" onClick={onRemove} title="remove">
        ×
      </button>
    </li>
  );
}

export function RankingEditor({
  initialRanked,
  seeded = false,
  allTeams,
  apList,
  tierRates,
}: {
  season?: number;
  initialRanked: TeamOpt[];
  seeded?: boolean;
  allTeams: TeamOpt[];
  apList: (TeamOpt & { rank: number })[];
  tierRates: Record<string, number>;
}) {
  const [ranked, setRanked] = useState<TeamOpt[]>(initialRanked);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<null | "ok" | string>(null);
  const [pending, start] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const rankedIds = useMemo(() => new Set(ranked.map((t) => t.id)), [ranked]);

  const ratingFor = (rank: number) => {
    const t = tierOf(rank);
    return t ? tierRates[t.name] : 0;
  };

  const add = (t: TeamOpt) => {
    if (rankedIds.has(t.id) || ranked.length >= YAHN_MAX_RANK) return;
    setRanked((r) => [...r, t]);
    setSaved(null);
  };
  const remove = (id: string) => {
    setRanked((r) => r.filter((t) => t.id !== id));
    setSaved(null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setRanked((r) => {
      const from = r.findIndex((t) => t.id === active.id);
      const to = r.findIndex((t) => t.id === over.id);
      return arrayMove(r, from, to);
    });
    setSaved(null);
  };

  const dirty =
    seeded ||
    ranked.length !== initialRanked.length ||
    ranked.some((t, i) => initialRanked[i]?.id !== t.id);

  const save = () =>
    start(async () => {
      const res = await saveRanking(ranked.map((t) => t.id));
      setSaved(res.ok ? "ok" : res.error ?? "save failed");
    });

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allTeams
      .filter(
        (t) =>
          !rankedIds.has(t.id) &&
          (t.name.toLowerCase().includes(q) ||
            (t.abbr ?? "").toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [query, allTeams, rankedIds]);

  // build the ranked list with tier separators interleaved
  const withSeps: (
    | { kind: "team"; t: TeamOpt; rank: number }
    | { kind: "sep"; tier: (typeof YAHN_TIERS)[number] }
  )[] = [];
  ranked.forEach((t, i) => {
    const rank = i + 1;
    const tier = YAHN_TIERS.find((x) => x.from === rank);
    if (tier && rank > 1) withSeps.push({ kind: "sep", tier });
    withSeps.push({ kind: "team", t, rank });
  });

  return (
    <div className="rk-wrap">
      <div className="rk-main">
        <div className="rk-toolbar">
          <button className="rk-save" onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : dirty ? "Save ranking" : "Saved"}
          </button>
          {dirty && (
            <button
              className="rk-reset"
              onClick={() => {
                setRanked(initialRanked);
                setSaved(null);
              }}
            >
              Reset
            </button>
          )}
          {saved === "ok" && <span className="rk-ok">Saved ✓</span>}
          {saved && saved !== "ok" && <span className="login-err">{saved}</span>}
          <span className="rk-count">
            {ranked.length}/{YAHN_MAX_RANK}
          </span>
        </div>

        {ranked.length === 0 ? (
          <p className="subhead">
            Nothing ranked yet — add teams from the AP list or the search on the
            right.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={ranked.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="rk-list">
                {withSeps.map((row) =>
                  row.kind === "sep" ? (
                    <li className="rk-sep" key={`sep-${row.tier.name}`}>
                      <span>{row.tier.name}</span>
                      <span className="mono">
                        +{(tierRates[row.tier.name] ?? 0).toFixed(1)}
                      </span>
                    </li>
                  ) : (
                    <SortableRow
                      key={row.t.id}
                      t={row.t}
                      rank={row.rank}
                      rating={ratingFor(row.rank)}
                      onRemove={() => remove(row.t.id)}
                    />
                  )
                )}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <aside className="rk-side">
        <div className="rk-panel">
          <div className="rk-panel-h">Add any team</div>
          <input
            className="rk-search"
            placeholder="search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searchResults.map((t) => (
            <button key={t.id} className="rk-add" onClick={() => add(t)}>
              <Logo t={t} />
              <span>{t.name}</span>
              <span className="rk-add-plus">+</span>
            </button>
          ))}
        </div>

        <div className="rk-panel">
          <div className="rk-panel-h">AP Top 25 · reference</div>
          {apList.length === 0 && <p className="subhead">No AP poll loaded.</p>}
          {apList.map((t) => {
            const inList = rankedIds.has(t.id);
            return (
              <button
                key={t.id}
                className={`rk-add${inList ? " rk-in" : ""}`}
                onClick={() => add(t)}
                disabled={inList || ranked.length >= YAHN_MAX_RANK}
              >
                <span className="rk-ap-rank">{t.rank}</span>
                <Logo t={t} />
                <span>{t.name}</span>
                <span className="rk-add-plus">{inList ? "✓" : "+"}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
