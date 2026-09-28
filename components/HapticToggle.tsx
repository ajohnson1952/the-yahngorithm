"use client";

import { haptic } from "../lib/haptics";

/**
 * A tappable control that ticks on iPhone. iOS web has no haptics API and
 * ignores programmatic tricks (a script-clicked hidden switch stays silent —
 * tested on iOS 18.7, standalone) — but a REAL finger toggling an
 * <input type="checkbox" switch> plays the system haptic. So the control is
 * a <label> with an invisible switch stretched over it (.haptic-input): the
 * tap lands on the switch, iOS ticks, and onChange runs the action.
 * Elsewhere it behaves like a normal toggle (Android also gets a vibrate).
 *
 * `checked` should mirror the control's on/off state so screen readers and
 * keyboard users (space toggles the focused switch) get the real state.
 */
export function HapticToggle({
  checked,
  onChange,
  className,
  label,
  title,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
  /** accessible name for the switch */
  label: string;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`haptic-toggle${className ? ` ${className}` : ""}`} title={title}>
      {children}
      <input
        type="checkbox"
        {...{ switch: "" }}
        className="haptic-input"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={() => {
          haptic(); // Android vibrate; iOS already ticked from the switch itself
          onChange();
        }}
      />
    </label>
  );
}
