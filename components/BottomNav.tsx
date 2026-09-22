"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Small inline line icons — no external assets, and `stroke="currentColor"`
// means each one automatically picks up the tab's active/inactive color for
// free. Kept intentionally simple to match the site's otherwise icon-free,
// typography-driven style (this is the only icon system in the app).
function IconWeek() {
  return (
    <svg viewBox="0 0 24 24" className="bn-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </svg>
  );
}
function IconWatch() {
  return (
    <svg viewBox="0 0 24 24" className="bn-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconPicks() {
  return (
    <svg viewBox="0 0 24 24" className="bn-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconGrades() {
  return (
    <svg viewBox="0 0 24 24" className="bn-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  );
}
function IconMore() {
  return (
    <svg viewBox="0 0 24 24" className="bn-icon" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

const TABS = [
  { href: "/", label: "This week", Icon: IconWeek },
  { href: "/watch", label: "Watch", Icon: IconWatch },
  { href: "/picks", label: "Picks", Icon: IconPicks },
  { href: "/grades", label: "Grades", Icon: IconGrades },
];
const MORE_LINKS = [
  { href: "/guide", label: "Guide" },
  { href: "/admin", label: "Admin" },
];

const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" : path.startsWith(href);

export function BottomNav() {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // close the "More" sheet on every navigation
  useEffect(() => setMoreOpen(false), [path]);

  const moreActive = MORE_LINKS.some((l) => isActive(path, l.href));

  return (
    <>
      {moreOpen && (
        <div className="bn-backdrop" onClick={() => setMoreOpen(false)} />
      )}
      {moreOpen && (
        <div className="bn-sheet" role="menu">
          {MORE_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              role="menuitem"
              className={isActive(path, l.href) ? "active" : ""}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
      <nav className="bottom-nav" aria-label="Primary">
        {TABS.map((t) => {
          const active = isActive(path, t.href);
          return (
            <a key={t.href} href={t.href} className={`bn-tab${active ? " active" : ""}`}>
              <t.Icon />
              {t.label}
            </a>
          );
        })}
        <button
          type="button"
          className={`bn-tab${moreActive ? " active" : ""}`}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          onClick={() => setMoreOpen((o) => !o)}
        >
          <IconMore />
          More
        </button>
      </nav>
    </>
  );
}
