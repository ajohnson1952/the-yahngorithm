import { unstable_cache } from "next/cache";
import { db } from "../../../lib/db";
import { LOGO_PICKS_TAG, logoEspnId } from "../../../lib/teamLogo";
import { noteDbTouch } from "../../../lib/dbTouch";

// GET /api/logo-picks: ESPN team ids whose dark-background logo was picked at
// /admin/logos, for Cavepicks (its games store ESPN logo links, so it matches
// on the id). Picks are set once and rarely touched, so this has its OWN cache
// tag, NOT the pipeline one: the tick expires the pipeline tag every ~30 min,
// and riding on it would make Cavepicks' 15-min check re-read (and possibly
// wake) the database all day for a list that never changes. Only saving a
// pick (setLogoPref) expires LOGO_PICKS_TAG, so this reads the database once
// after a change or a deploy, not on a schedule.
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
