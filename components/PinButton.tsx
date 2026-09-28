"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { togglePin } from "../app/actions";
import { HapticToggle } from "./HapticToggle";

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

  const toggle = () => {
    const next = !on;
    setOn(next); // optimistic
    start(async () => {
      const res = await togglePin(gameId);
      if (!res.ok) setOn(!next);
      else router.refresh();
    });
  };

  return (
    // a switch under the finger so iPhones tick — see HapticToggle
    <HapticToggle
      checked={on}
      onChange={toggle}
      disabled={busy}
      label={on ? "Unpin this game" : "Pin this game"}
      title={on ? "Unpin" : "Pin this game"}
      className={`pin-btn${on ? " on" : ""}${large ? " lg" : ""}`}
    >
      {on ? "★" : "☆"}
    </HapticToggle>
  );
}
