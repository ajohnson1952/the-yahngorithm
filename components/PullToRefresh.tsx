"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Pull-to-refresh for the iOS home-screen (standalone) app, which has no
// browser chrome and no native pull-to-refresh. Safari tabs already have
// their own, so this only switches on in standalone mode. A refresh re-runs
// the page's server components (router.refresh) — same data path as
// navigating there; the board's 2-min data cache still applies, /watch
// re-pulls live scores.

const TRIGGER = 64; // px of (damped) pull needed to refresh
const MAX = 96;

export function PullToRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, start] = useTransition();
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const pullRef = useRef(0);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setEnabled(standalone);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      // only from the very top of the page, one finger
      if (window.scrollY > 0 || e.touches.length !== 1) return;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = Math.abs(e.touches[0].clientX - startX.current);
      // sideways swipe (jump bar, flag chips) or scrolling up — not a pull
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        startY.current = null;
        set(0);
        return;
      }
      set(Math.min(MAX, dy * 0.5));
    };
    const onEnd = () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pullRef.current >= TRIGGER) start(() => router.refresh());
      set(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, router]);

  if (!enabled || (pull === 0 && !refreshing)) return null;

  const armed = pull >= TRIGGER;
  // starts 40px up, tucked behind the top bar (see .ptr) — so it peeks out as
  // you pull and sits ~24px below the bar once armed / while refreshing
  const offset = refreshing ? TRIGGER : pull;
  return (
    <div
      className={`ptr${refreshing ? " spinning" : ""}`}
      style={{ transform: `translate(-50%, ${offset}px)` }}
      aria-live="polite"
      aria-label={refreshing ? "Refreshing" : undefined}
    >
      <span
        className="ptr-icon"
        style={refreshing ? undefined : { transform: `rotate(${armed ? 180 : (pull / TRIGGER) * 180}deg)` }}
      >
        {refreshing ? "↻" : "↓"}
      </span>
    </div>
  );
}
