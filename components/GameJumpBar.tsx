"use client";

/** The game page's sticky section jump bar. Each chip scrolls to its section
 *  — the h2's scroll-margin-top keeps it clear of the top bar + this bar —
 *  and updates the #hash without adding a history entry.
 *
 *  Plain buttons, deliberately NOT HapticToggles: the bar scrolls sideways on
 *  phones, and an iOS switch swallows horizontal drags (it's draggable), so
 *  invisible switches over the chips blocked the scroll. */
export function GameJumpBar({ items }: { items: { id: string; label: string }[] }) {
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };
  return (
    <nav className="gjump" aria-label="Jump to section">
      {items.map((j) => (
        <button key={j.id} type="button" className="gjump-chip" onClick={() => jump(j.id)}>
          {j.label}
        </button>
      ))}
    </nav>
  );
}
