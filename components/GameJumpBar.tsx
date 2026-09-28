"use client";

import { HapticToggle } from "./HapticToggle";

/** The game page's sticky section jump bar. Each chip is a momentary
 *  HapticToggle (ticks on iPhone, never stays "on") that scrolls to its
 *  section — the h2's scroll-margin-top keeps it clear of the top bar +
 *  this bar. Updates the #hash without adding a history entry. */
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
        <HapticToggle
          key={j.id}
          checked={false}
          onChange={() => jump(j.id)}
          label={`Jump to ${j.label}`}
          className="gjump-chip"
        >
          {j.label}
        </HapticToggle>
      ))}
    </nav>
  );
}
