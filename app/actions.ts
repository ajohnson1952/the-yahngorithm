"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "../lib/db";

/** Toggle a game's pin for the current visitor. Pins are per-browser
 *  (keyed on the anonymous `yahn_uid` cookie set by middleware) — no
 *  accounts. Returns the new pinned state. */
export async function togglePin(
  gameId: string
): Promise<{ ok: boolean; pinned?: boolean; error?: string }> {
  if (typeof gameId !== "string" || gameId.length < 8) {
    return { ok: false, error: "Bad game id." };
  }

  const jar = await cookies();
  let uid = jar.get("yahn_uid")?.value;
  if (!uid) {
    // middleware normally sets this; cover the direct-POST edge case.
    uid = crypto.randomUUID();
    jar.set("yahn_uid", uid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  const existing = await db.pinnedGame.findUnique({
    where: { gameId_uid: { gameId, uid } },
  });
  if (existing) {
    await db.pinnedGame.delete({ where: { id: existing.id } });
  } else {
    const game = await db.game.findUnique({ where: { id: gameId }, select: { id: true } });
    if (!game) return { ok: false, error: "No such game." };
    await db.pinnedGame.create({ data: { gameId, uid } });
  }
  revalidatePath("/");
  revalidatePath(`/game/${gameId}`);
  return { ok: true, pinned: !existing };
}
