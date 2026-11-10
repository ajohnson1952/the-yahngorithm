"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sportOf, SPORT_HOME } from "./sport";

/** Brand link (goes to the current sport's home) + the CFB / CBB switch. */
export function BrandAndToggle({ children }: { children: React.ReactNode }) {
  const sport = sportOf(usePathname());
  return (
    <div className="brand-wrap">
      <Link href={SPORT_HOME[sport]} className="brand">
        {children}
      </Link>
      <div className="sport-toggle" role="group" aria-label="Sport">
        <Link href="/cfb" className={sport === "cfb" ? "on" : ""} aria-current={sport === "cfb" ? "page" : undefined}>
          CFB
        </Link>
        <Link href="/cbb" className={sport === "cbb" ? "on" : ""} aria-current={sport === "cbb" ? "page" : undefined}>
          CBB
        </Link>
      </div>
    </div>
  );
}
