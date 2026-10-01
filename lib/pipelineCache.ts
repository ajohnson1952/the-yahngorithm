// ============================================================
// "The site only reads the DB when the pipeline has changed it."
// ============================================================
// Neon bills ≥5 min of compute for every wake-up, and ~75% of September's
// awake time was the WEBSITE, not the pipeline: bots/crawlers at all hours,
// each landing on a short-TTL (2 min) cache miss or an uncached per-request
// query. So every pipeline-derived cache (week board, game detail, picks,
// grades, current week, weeks list) now:
//   - carries PIPELINE_TAG, which scripts/tick.ts expires through
//     POST /api/revalidate at the end of every run (and the /admin script
//     runner expires in-process), and
//   - keeps PIPELINE_TTL (12 h) only as a backstop in case that call fails.
// Freshness is the same or better than the old 2-min TTLs (data only ever
// changes when the pipeline runs); DB wake-ups from the web drop to roughly
// one per tick — and the tick itself only runs 8am–10pm CT (Sat to 2am).
// ============================================================

import { createHash } from "crypto";

export const PIPELINE_TAG = "pipeline";

/** Backstop only — the tick's revalidate call is what refreshes these. Long
 *  on purpose: the tick is quiet 10pm–8am CT, and a short TTL would let
 *  overnight bot traffic re-wake the DB every time it lapsed even though
 *  nothing changed. The price is that a broken revalidate call could leave
 *  the site up to this stale — so tick.ts fails the run on a token mismatch
 *  rather than let that happen quietly. */
export const PIPELINE_TTL = 12 * 3600;

/** Per-visitor pin list cache tag — expired by the togglePin action. */
export const pinsTag = (uid: string) => `pins:${uid}`;

export const SITE_URL = process.env.SITE_URL ?? "https://the-yahngorithm.com";

/** Shared secret for /api/revalidate without a new env var: a one-way hash
 *  of the CFBD key, which both GitHub Actions and Vercel already hold. If the
 *  two ever disagree (key rotated in only one place) the call 401s, the tick
 *  logs it, and the caches just fall back to PIPELINE_TTL. */
export function revalidateToken(): string | null {
  const k = process.env.CFBD_API_KEY;
  return k ? createHash("sha256").update(`yahn-revalidate:${k}`).digest("hex") : null;
}
