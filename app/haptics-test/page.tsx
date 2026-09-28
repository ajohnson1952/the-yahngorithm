import type { Metadata } from "next";
import { HapticsTest } from "./HapticsTest";

// Unlinked diagnostic page — which haptic trick (if any) fires on this
// device / iOS version / standalone mode. Remove once haptics are settled.
export const metadata: Metadata = {
  title: "Haptics test · the yahngorithm",
  robots: { index: false },
};

export default function Page() {
  return <HapticsTest />;
}
