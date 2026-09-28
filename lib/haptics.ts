// ============================================================
// Haptic tick — client-only, best-effort, silent where unsupported.
// ============================================================
// Android/Chrome: the Vibration API. iOS Safari has no Vibration API, but
// since iOS 18 toggling an <input type="checkbox" switch> plays the system
// "switch" haptic — so we click a throwaway hidden switch (the same trick the
// small `ios-haptics` libraries use). It only fires in response to a user
// touch; from a timer it's just a no-op.
// ============================================================

export function haptic(): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function" && navigator.vibrate(10)) return;
    const label = document.createElement("label");
    label.ariaHidden = "true";
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    label.remove();
  } catch {
    /* no haptics here — fine */
  }
}
