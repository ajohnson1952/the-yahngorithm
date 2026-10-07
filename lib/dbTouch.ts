// ============================================================
// "What made the site read the database?" — a tiny rolling log.
// ============================================================
// On Neon Free every database wake-up costs ≥ 5 min of a fixed monthly
// allowance, and the wake log only says WHEN, not WHY. Each cache-miss
// rebuild (the only way a public page reaches the DB) calls noteDbTouch with
// what it was building; the newest ~400 entries live in one Meta row
// (`dbTouchLog`). Read it with:  npm run db-touches
// Entries at :00/:30 during the day are the tick's own warm-up — the
// interesting ones are everything else, especially overnight.
//
// Free to record: it only ever runs when the DB is already awake for the
// rebuild itself. Fire-and-forget; it must never break a page.
// ============================================================

import { db } from "./db";

export function noteDbTouch(what: string): void {
  const entry = JSON.stringify([{ t: new Date().toISOString(), w: what }]);
  db.$executeRaw`
    INSERT INTO "Meta" ("key", "value", "updatedAt")
    VALUES ('dbTouchLog', ${entry}::jsonb, now())
    ON CONFLICT ("key") DO UPDATE SET
      "value" = (
        SELECT COALESCE(jsonb_agg(e ORDER BY i), '[]'::jsonb)
        FROM (
          SELECT e, i
          FROM jsonb_array_elements("Meta"."value"::jsonb || EXCLUDED."value"::jsonb) WITH ORDINALITY AS t(e, i)
          ORDER BY i DESC
          LIMIT 400
        ) s
      ),
      "updatedAt" = now()
  `.catch(() => {});
}
