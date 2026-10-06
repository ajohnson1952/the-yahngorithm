import { currentSeason, currentWeek } from "../../../lib/currentWeek";
import { buildFeed } from "../../../lib/feed";

// GET /api/feed[?week=N] — the week's games + the model's picks, for
// Cavepicks. Read-only and public (it's the same information the site
// already shows). Only the current week and its neighbors are served: those
// are the weeks whose caches the tick keeps warm, so a request can't be used
// to make the site read the database for some arbitrary old week.
export async function GET(req: Request) {
  const season = currentSeason();
  const thisWeek = await currentWeek(season);
  const raw = Number(new URL(req.url).searchParams.get("week"));
  const week = Number.isInteger(raw) && raw >= 1 && raw <= 25 ? raw : thisWeek;
  if (Math.abs(week - thisWeek) > 1) {
    return Response.json({ season, week, games: [], note: "only the current week ±1 is served" });
  }
  return Response.json(await buildFeed(season, week), {
    headers: { "cache-control": "public, max-age=60" },
  });
}
