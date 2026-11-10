"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sportOf, SPORT_HOME } from "./sport";

export const CAVEPICKS_URL = "https://www.cavepicks.com";

const LINKS = {
  cfb: [
    { href: "/cfb", label: "This week" },
    { href: "/cfb/watch", label: "Watch guide" },
    { href: "/cfb/picks", label: "Picks" },
    { href: "/cfb/grades", label: "Grades" },
    { href: "/cfb/guide", label: "Guide" },
    { href: "/admin", label: "Admin" },
  ],
  cbb: [
    { href: "/cbb", label: "Today" },
    { href: "/admin", label: "Admin" },
  ],
};

export function Nav() {
  const path = usePathname();
  const sport = sportOf(path);
  return (
    <nav className="nav">
      {LINKS[sport].map((l) => {
        const active =
          l.href === SPORT_HOME[sport] ? path === l.href : path.startsWith(l.href);
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
