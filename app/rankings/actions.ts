"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "../../lib/db";
import { currentSeason } from "../../lib/currentWeek";
import {
  ADMIN_PASSWORD,
  ADMIN_COOKIE,
  adminToken,
  isAdmin,
} from "../../lib/adminAuth";
import { YAHN_MAX_RANK } from "../../lib/yahn";

export async function login(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  const pw = String(formData.get("password") ?? "");
  if (pw !== ADMIN_PASSWORD) return { error: "Wrong password." };
  (await cookies()).set(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
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
  const ids = orderedTeamIds.slice(0, YAHN_MAX_RANK);
  await db.$transaction([
    db.yahnRanking.deleteMany({ where: { season } }),
    db.yahnRanking.createMany({
      data: ids.map((teamId, i) => ({ season, teamId, rank: i + 1 })),
    }),
  ]);
  revalidatePath("/rankings");
  revalidatePath("/");
  return { ok: true };
}
