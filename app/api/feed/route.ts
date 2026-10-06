import { currentSeason, currentWeek } from "../../../lib/currentWeek";
import { buildFeed } from "../../../lib/feed";

// GET /api/feed[?week=N] — the week's games + the model's picks, for
// Cavepicks. Read-only and public (it's the same information the site
// already shows). Serves any week of this season up to next week. Only the
// current week is kept warm by the tick; an older week costs one database
// read the first time it's asked for after a tick (Cavepicks only does that
// for its one-off ghost-player backfill).
export async function GET(req: Request) {
  const season = currentSeason();
  const thisWeek = await currentWeek(season);
  const raw = Number(new URL(req.url).searchParams.get("week"));
  const week = Number.isInteger(raw) && raw >= 1 && raw <= 25 ? raw : thisWeek;
  if (week > thisWeek + 1) {
    return Response.json({ season, week, games: [], note: "no data that far ahead" });
  }
  return Response.json(await buildFeed(season, week), {
    headers: { "cache-control": "public, max-age=60" },
  });
}
