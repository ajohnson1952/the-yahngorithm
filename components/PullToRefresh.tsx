"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "../lib/haptics";

// Pull-to-refresh for the iOS home-screen (standalone) app, which has no
// browser chrome and no native pull-to-refresh. Safari tabs already have
// their own, so this only switches on in standalone mode.
//
// It rides iOS's own rubber-band instead of fighting it: the arrow lives in
// the document ABOVE the page's top edge (.ptr-well, top: -44px), so the
// overscroll bounce itself reveals it and it moves with native physics — no
// per-frame JS positioning (an earlier fixed-position badge jittered against
// the bounce). JS only watches how far past the top you've pulled (iOS
// reports a negative scrollY while rubber-banding), flips the arrow once
// it's far enough (with a haptic tick), and on release runs router.refresh(). While that's in
// flight an iOS-style activity spinner shows in the top bar's empty right
// side (and replaces the arrow in the well as the bounce settles).

const TRIGGER = 80; // px of overscroll needed to refresh
const MIN_SPIN_MS = 700; // a cache-hit refresh lands in ~200ms — don't just flash

/** iOS-style activity indicator: 8 spokes, fading tail, stepped rotation. */
function Spinner({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`ios-spinner ${className}`} aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          x1="12" y1="2.5" x2="12" y2="7"
          transform={`rotate(${i * 45} 12 12)`}
          opacity={(i + 1) / 8}
        />
      ))}
    </svg>
  );
}

export function PullToRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [refreshing, start] = useTransition();
  const [minSpin, setMinSpin] = useState(false);
  const spinning = refreshing || minSpin;
  const well = useRef<HTMLDivElement>(null);
  const tracking = useRef(false);
  const maxPull = useRef(0);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setEnabled(standalone);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // one haptic tick each time the pull crosses into "release to refresh" —
    // the same moment native iOS pull-to-refresh ticks
    let armed = false;
    const setArmed = (on: boolean) => {
      if (on && !armed) haptic();
      armed = on;
      well.current?.classList.toggle("armed", on);
    };
    const onStart = (e: TouchEvent) => {
      tracking.current = window.scrollY <= 0 && e.touches.length === 1;
      maxPull.current = 0;
    };
    const onMove = () => {
      if (!tracking.current) return;
      maxPull.current = Math.max(maxPull.current, -window.scrollY);
      setArmed(-window.scrollY >= TRIGGER);
    };
    const onEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      setArmed(false);
      if (maxPull.current >= TRIGGER) {
        setMinSpin(true);
        setTimeout(() => setMinSpin(false), MIN_SPIN_MS);
        start(() => router.refresh());
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, router]);

  if (!enabled) return null;
  return (
    <>
      <div ref={well} className="ptr-well" aria-hidden>
        {spinning ? <Spinner className="ptr-well-spin" /> : <span className="ptr-arrow">↓</span>}
      </div>
      {spinning && (
        <div className="ptr-status" role="status" aria-label="Refreshing">
          <Spinner className="ptr-status-spin" />
        </div>
      )}
    </>
  );
}
