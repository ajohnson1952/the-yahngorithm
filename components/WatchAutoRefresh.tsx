"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Live-score refresher for /watch. Re-runs the server component (which
 *  re-pulls ESPN and re-ranks the quadbox) on an interval while games are
 *  on, plus a manual button. `renderedAt` comes fresh from the server on
 *  every render, so it doubles as the "last updated" clock and the signal
 *  that a refresh landed. */
export function WatchAutoRefresh({
  active,
  renderedAt,
  intervalSec = 60,
}: {
  active: boolean;
  renderedAt: number;
  intervalSec?: number;
}) {
  const router = useRouter();
  const [on, setOn] = useState(active);
  const [now, setNow] = useState(renderedAt);
  const busy = useRef(false);

  // 1s heartbeat for the "updated Ns ago" label
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // a new server payload arrived — clear the in-flight guard
  useEffect(() => {
    busy.current = false;
  }, [renderedAt]);

  const ageSec = Math.max(0, Math.round((now - renderedAt) / 1000));

  useEffect(() => {
    if (!on || busy.current) return;
    if (ageSec >= intervalSec) {
      busy.current = true;
      router.refresh();
    }
  }, [on, ageSec, intervalSec, router]);

  const refreshNow = () => {
    busy.current = true;
    setNow(Date.now());
    router.refresh();
  };

  return (
    <div className="watch-refresh">
      <button type="button" onClick={refreshNow} aria-label="refresh live scores">
        ↻ refresh
      </button>
      <button
        type="button"
        className={on ? "on" : ""}
        onClick={() => setOn((v) => !v)}
        aria-pressed={on}
      >
        {on ? "● auto" : "○ auto"}
      </button>
      <span>
        {busy.current
          ? "updating…"
          : ageSec < 5
            ? "updated just now"
            : `updated ${ageSec < 90 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`} ago`}
      </span>
    </div>
  );
}
