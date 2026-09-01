"use server";

import { revalidatePath } from "next/cache";
import { db } from "../lib/db";

/** Toggle a game's pin. Open to anyone using the site — pins are a shared
 *  "watch list" on this personal tool, not a protected setting. Returns
 *  the new pinned state. */
export async function togglePin(
  gameId: string
): Promise<{ ok: boolean; pinned?: boolean; error?: string }> {
  if (typeof gameId !== "string" || gameId.length < 8) {
    return { ok: false, error: "Bad game id." };
  }
  const existing = await db.pinnedGame.findUnique({ where: { gameId } });
  if (existing) {
    await db.pinnedGame.delete({ where: { gameId } });
  } else {
    // ignore a bad id (FK will throw) — treat as no-op
    const game = await db.game.findUnique({ where: { id: gameId }, select: { id: true } });
    if (!game) return { ok: false, error: "No such game." };
    await db.pinnedGame.create({ data: { gameId } });
  }
  revalidatePath("/");
  revalidatePath(`/game/${gameId}`);
  return { ok: true, pinned: !existing };
}
