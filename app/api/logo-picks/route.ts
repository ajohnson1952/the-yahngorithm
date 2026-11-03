import { unstable_cache } from "next/cache";
import { db } from "../../../lib/db";
import { LOGO_PICKS_TAG, logoEspnId } from "../../../lib/teamLogo";
import { noteDbTouch } from "../../../lib/dbTouch";

// GET /api/logo-picks: ESPN team ids whose dark-background logo was picked at
// /admin/logos. Cavepicks does NOT read this at runtime: its
// `npm run sync-logos` copies it into Cavepicks' code (lib/darkLogoIds.ts)
// when picks change. (Its games store ESPN logo links, so it matches on id.)
// Has its own cache tag, not the pipeline one, so it only reads the database
// after a pick is saved (setLogoPref) or a deploy, never on a schedule.
const cachedDarkIds = unstable_cache(
  async () => {
    noteDbTouch("logo picks");
    const teams = await db.team.findMany({
      where: { logoPref: "dark" },
      select: { logoLight: true, logoDark: true, espnId: true },
    });
    const ids = teams
      .map((t) => logoEspnId(t.logoLight) ?? logoEspnId(t.logoDark) ?? t.espnId)
      .filter((n): n is number => n != null);
    return [...new Set(ids)].sort((a, b) => a - b);
  },
  ["logo-picks"],
  // no time limit: only a saved pick (or a new deploy) refreshes it
  { revalidate: false, tags: [LOGO_PICKS_TAG] }
);

export async function GET() {
  return Response.json(
    { dark: await cachedDarkIds() },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}
