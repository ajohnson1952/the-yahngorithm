"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "../../lib/db";
import { currentSeason, currentWeek } from "../../lib/currentWeek";
import { recomputeYahnSpreads } from "../../lib/recomputeYahn";
import {
  ADMIN_PASSWORD,
  ADMIN_COOKIE,
  adminToken,
  safeEqual,
  isAdmin,
} from "../../lib/adminAuth";
import { YAHN_MAX_RANK } from "../../lib/yahn";

// Best-effort brute-force throttle. Per-process (fine for a single Render
// instance); resets on redeploy. The 4-digit default password is only ~10k
// guesses, so this matters until a real ADMIN_PASSWORD is set.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
let attempts: { count: number; first: number } = { count: 0, first: 0 };

export async function login(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  const now = Date.now();
  if (now - attempts.first > WINDOW_MS) attempts = { count: 0, first: now };
  if (attempts.count >= MAX_ATTEMPTS) {
    return { error: "Too many attempts — wait a few minutes." };
  }

  const pw = String(formData.get("password") ?? "");
  if (!safeEqual(pw, ADMIN_PASSWORD)) {
    attempts.count++;
    // small constant delay so failures aren't a fast oracle
    await new Promise((r) => setTimeout(r, 400));
    return { error: "Wrong password." };
  }

  attempts = { count: 0, first: now };
  (await cookies()).set(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  revalidatePath("/rankings");
  revalidatePath("/admin");
  return {};
}

export async function logout(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
  revalidatePath("/rankings");
}

export async function saveRanking(
  orderedTeamIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Not signed in." };
  const season = currentSeason();

  // Don't trust the client list: drop dupes (would trip @@unique([season,rank])
  // /[season,teamId] and 500 the transaction), keep order, cap at the max, and
  // keep only ids that are real FBS teams.
  const requested = Array.from(new Set(orderedTeamIds)).slice(0, YAHN_MAX_RANK);
  const known = new Set(
    (
      await db.team.findMany({
        where: { id: { in: requested }, classification: "fbs" },
        select: { id: true },
      })
    ).map((t) => t.id)
  );
  const ids = requested.filter((id) => known.has(id));

  await db.$transaction([
    db.yahnRanking.deleteMany({ where: { season } }),
    db.yahnRanking.createMany({
      data: ids.map((teamId, i) => ({ season, teamId, rank: i + 1 })),
    }),
  ]);
  // push the change onto this week's board immediately
  try {
    await recomputeYahnSpreads(season, await currentWeek(season));
  } catch {
    /* board will catch up on the next model run */
  }
  revalidatePath("/rankings");
  revalidatePath("/");
  return { ok: true };
}
