"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
// it's far enough, and on release runs router.refresh(). While that's in
// flight a thin progress bar runs along the bottom of the top bar.

const TRIGGER = 80; // px of overscroll needed to refresh

export function PullToRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [refreshing, start] = useTransition();
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
    const setArmed = (on: boolean) => well.current?.classList.toggle("armed", on);
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
      if (maxPull.current >= TRIGGER) start(() => router.refresh());
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
        <span className="ptr-arrow">↓</span>
      </div>
      {refreshing && <div className="ptr-bar" role="progressbar" aria-label="Refreshing" />}
    </>
  );
}
