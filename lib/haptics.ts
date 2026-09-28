// ============================================================
// Haptic tick — Android only (the Vibration API). Silent elsewhere.
// ============================================================
// iOS web has no Vibration API, and it ignores programmatic tricks: clicking
// a hidden <input switch> from script plays nothing (tested on iOS 18.7,
// standalone, five variants). Only a real finger on a switch ticks — which
// is what components/HapticToggle.tsx builds its controls around. Use that
// for anything tappable; this is just the Android half.
// ============================================================

export function haptic(): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(10);
    }
  } catch {
    /* no haptics here — fine */
  }
}
