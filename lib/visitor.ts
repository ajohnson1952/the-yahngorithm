import { cookies, headers } from "next/headers";

/** The anonymous per-browser id (set by proxy.ts) and whether it was minted
 *  on THIS request. A new id can't have pins yet, so callers skip the pin
 *  lookup for it — that lookup was waking Neon on every bot hit. */
export async function visitor(): Promise<{ uid: string; isNew: boolean }> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return {
    uid: jar.get("yahn_uid")?.value ?? "",
    isNew: h.get("x-yahn-new-uid") === "1",
  };
}
