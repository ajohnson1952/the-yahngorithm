"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const CAVEPICKS_URL = "https://www.cavepicks.com";

const LINKS = [
  { href: "/", label: "This week" },
  { href: "/watch", label: "Watch guide" },
  { href: "/picks", label: "Picks" },
  { href: "/grades", label: "Grades" },
  { href: "/guide", label: "Guide" },
  { href: "/admin", label: "Admin" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => {
        const active =
          l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""}>
            {l.label}
          </Link>
        );
      })}
      {/* the owner's pick'em app — a different site, so a plain link */}
      <a href={CAVEPICKS_URL} target="_blank" rel="noreferrer" className="nav-cave">
        <img src="/cavepicks.png" alt="" width={18} height={18} />
        Cavepicks
      </a>
    </nav>
  );
}
