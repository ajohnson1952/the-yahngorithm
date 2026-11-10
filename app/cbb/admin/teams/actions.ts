"use server";

import { db } from "../../../../lib/db";
import { isAdmin } from "../../../../lib/adminAuth";

type Res = { ok: boolean; error?: string; count?: number };

/** Mark one suggested alias as confirmed — the pipeline will now use it. */
export async function confirmAlias(id: string): Promise<Res> {
  if (!(await isAdmin())) return { ok: false, error: "Not signed in." };
  await db.cbbTeamAlias.update({ where: { id }, data: { confidence: "confirmed" } });
  return { ok: true };
}

/** Confirm every remaining suggestion (optionally for one source). */
export async function confirmAllSuggestions(source?: string): Promise<Res> {
  if (!(await isAdmin())) return { ok: false, error: "Not signed in." };
  const r = await db.cbbTeamAlias.updateMany({
    where: { confidence: "needs_review", ...(source ? { source } : {}) },
    data: { confidence: "confirmed" },
  });
  return { ok: true, count: r.count };
}

/** Throw out a wrong suggestion. The name then shows as unmatched on the next
 *  `npm run cbb:match-names` — fix it in data/cbb/manualAliases.json. */
export async function rejectAlias(id: string): Promise<Res> {
  if (!(await isAdmin())) return { ok: false, error: "Not signed in." };
  await db.cbbTeamAlias.delete({ where: { id } });
  return { ok: true };
}
