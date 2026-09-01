"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { togglePin } from "../app/actions";

export function PinButton({
  gameId,
  pinned,
  large = false,
}: {
  gameId: string;
  pinned: boolean;
  large?: boolean;
}) {
  const [on, setOn] = useState(pinned);
  const [busy, start] = useTransition();
  const router = useRouter();

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !on;
    setOn(next); // optimistic
    start(async () => {
      const res = await togglePin(gameId);
      if (!res.ok) setOn(!next);
      else router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={on ? "Unpin" : "Pin this game"}
      className={`pin-btn${on ? " on" : ""}${large ? " lg" : ""}`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
