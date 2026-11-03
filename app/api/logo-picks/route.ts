import { unstable_cache } from "next/cache";
import { db } from "../../../lib/db";
import { PIPELINE_TAG, PIPELINE_TTL } from "../../../lib/pipelineCache";
import { logoEspnId } from "../../../lib/teamLogo";
import { noteDbTouch } from "../../../lib/dbTouch";

// GET /api/logo-picks: ESPN team ids whose dark-background logo was picked at
// /admin/logos, for Cavepicks (its games store ESPN logo links, so it matches
// on the id). Cached like every public read: saving a pick expires the
// pipeline tag, so this costs one database read after a change, not one per
// request.
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
  { revalidate: PIPELINE_TTL, tags: [PIPELINE_TAG] }
);

export async function GET() {
  return Response.json(
    { dark: await cachedDarkIds() },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}
