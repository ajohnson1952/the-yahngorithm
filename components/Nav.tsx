"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "This week" },
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
          <a key={l.href} href={l.href} className={active ? "active" : ""}>
            {l.label}
          </a>
        );
      })}
    </nav>
  );
}
