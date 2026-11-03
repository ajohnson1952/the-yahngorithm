"use server";

import { updateTag } from "next/cache";
import { db } from "../../../lib/db";
import { isAdmin } from "../../../lib/adminAuth";
import { PIPELINE_TAG } from "../../../lib/pipelineCache";
import type { LogoChoice } from "../../../lib/teamLogo";

/** Save which logo a team shows, then expire the site's caches so the board,
 *  game pages and Cavepicks' logo list pick it up on their next load. */
export async function setLogoPref(
  teamId: string,
  choice: LogoChoice
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Not signed in." };
  if (choice !== "light" && choice !== "dark") return { ok: false, error: "Bad choice." };
  await db.team.update({
    where: { id: teamId },
    // null = the standard logo (the default), so only real picks are stored
    data: { logoPref: choice === "dark" ? "dark" : null },
  });
  updateTag(PIPELINE_TAG);
  return { ok: true };
}
