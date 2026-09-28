"use client";

import { haptic } from "../lib/haptics";

/** A segmented control's wrapper (the board's sort toggle): ticks like a
 *  native iOS segmented control when the selection changes. The segments
 *  themselves stay plain server-rendered <Link>s; tapping the one that's
 *  already selected (`.on`) doesn't tick. */
export function HapticSegmented({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={className}
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a && !a.classList.contains("on")) haptic();
      }}
    >
      {children}
    </div>
  );
}
