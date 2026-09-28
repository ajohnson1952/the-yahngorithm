"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HapticToggle } from "./HapticToggle";

/** The board's sort control (kickoff / edge / pinned) as a segmented control
 *  that ticks on iPhone: each segment is a HapticToggle that navigates on
 *  change. The selected segment's switch is disabled, so re-tapping it
 *  neither navigates nor ticks — like a native segmented control. */
export function SortSegments({
  items,
}: {
  items: { href: string; on: boolean; label: string; children: React.ReactNode }[];
}) {
  const router = useRouter();
  // these were <Link>s — keep their prefetch so switching stays instant
  useEffect(() => {
    for (const it of items) if (!it.on) router.prefetch(it.href);
  }, [items, router]);

  return (
    <div className="sort-toggle" role="group" aria-label="Sort">
      {items.map((it) => (
        <HapticToggle
          key={it.href}
          checked={it.on}
          disabled={it.on}
          onChange={() => router.push(it.href)}
          label={it.label}
          className={`seg${it.on ? " on" : ""}`}
        >
          {it.children}
        </HapticToggle>
      ))}
    </div>
  );
}
