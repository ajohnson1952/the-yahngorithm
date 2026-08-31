import { isAdmin } from "../../lib/adminAuth";
import { db } from "../../lib/db";
import { currentSeason } from "../../lib/currentWeek";
import { tierRatings, YAHN_TIERS } from "../../lib/yahn";
import { LoginForm } from "./LoginForm";
import { RankingEditor } from "./RankingEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Top 25 · the yahngorithm" };

export interface TeamOpt {
  id: string;
  name: string;
  abbr: string | null;
  logo: string | null;
  conference: string | null;
  spPlus: number | null;
}

export default async function RankingsPage() {
  const admin = await isAdmin();
  const season = currentSeason();

  if (!admin) {
    return (
      <>
        <h1>My Top 25</h1>
        <p className="subhead">
          Your eye-test ranking. It drives a third spread model alongside SP+ and
          SRS — see the guide for how the tiers become a point spread.
        </p>
        <LoginForm />
      </>
    );
  }

  // latest week that has SP+ ratings, for the tier-rating preview
  const latestRatingWeek = await db.teamRatingWeekly.findFirst({
    where: { season, spPlusOverall: { not: null } },
    orderBy: { week: "desc" },
    select: { week: true },
  });

  const [teams, ratings, yahn, apRanks] = await Promise.all([
    db.team.findMany({
      where: { classification: "fbs" },
      select: {
        id: true,
        canonicalName: true,
        abbreviation: true,
        logoLight: true,
        conference: true,
      },
      orderBy: { canonicalName: "asc" },
    }),
    latestRatingWeek
      ? db.teamRatingWeekly.findMany({
          where: { season, week: latestRatingWeek.week, spPlusOverall: { not: null } },
          select: { teamId: true, spPlusOverall: true },
        })
      : Promise.resolve([]),
    db.yahnRanking.findMany({
      where: { season },
      orderBy: { rank: "asc" },
      select: { teamId: true, rank: true },
    }),
    db.ranking.findMany({
      where: { season, poll: "ap" },
      orderBy: [{ week: "desc" }, { rank: "asc" }],
      select: { teamId: true, rank: true, week: true },
    }),
  ]);

  const spByTeam = new Map(ratings.map((r) => [r.teamId, r.spPlusOverall]));
  const opts: TeamOpt[] = teams.map((t) => ({
    id: t.id,
    name: t.canonicalName,
    abbr: t.abbreviation,
    logo: t.logoLight,
    conference: t.conference,
    spPlus: spByTeam.get(t.id) ?? null,
  }));
  const optById = new Map(opts.map((o) => [o.id, o]));

  const savedRanked = yahn
    .map((y) => optById.get(y.teamId))
    .filter((x): x is TeamOpt => !!x);

  // AP top 25 = the most recent poll week we have
  const apWeek = apRanks[0]?.week;
  const apList = apRanks
    .filter((r) => r.week === apWeek)
    .map((r) => ({ ...optById.get(r.teamId), rank: r.rank }))
    .filter((x): x is TeamOpt & { rank: number } => !!x.id);

  // no ranking saved yet -> seed the editor from the AP top 25
  const seeded = savedRanked.length === 0 && apList.length > 0;
  const startingRanked = seeded
    ? apList.map(({ rank: _r, ...t }) => t as TeamOpt)
    : savedRanked;

  const tierRates = tierRatings(
    ratings.map((r) => r.spPlusOverall!).filter((x) => x != null)
  );
  const tierRateObj: Record<string, number> = {};
  for (const t of YAHN_TIERS) tierRateObj[t.name] = tierRates.get(t.name) ?? 0;

  return (
    <>
      <h1>My Top 25</h1>
      <p
        className="subhead"
        style={{
          color: "var(--amber)",
          border: "1px solid color-mix(in srgb, var(--amber) 30%, var(--border))",
          borderRadius: 8,
          padding: "8px 12px",
        }}
      >
        <strong>Parked.</strong> This tool isn&apos;t wired into anything right now
        — the Yahn model runs on stats only, and the calibration work found no
        edge to justify folding an eye-test ranking in. Kept here in case that
        changes. It&apos;s off the nav.
      </p>
      <p className="subhead">
        Drag to reorder. Tier numbers preview what each slot would be worth if it
        were ever plugged back in.
      </p>
      {seeded && (
        <p className="subhead" style={{ color: "var(--amber)" }}>
          Started from this week&apos;s AP Top 25 — reorder it to your taste and
          hit Save.
        </p>
      )}
      <RankingEditor
        season={season}
        initialRanked={startingRanked}
        seeded={seeded}
        allTeams={opts}
        apList={apList}
        tierRates={tierRateObj}
      />
    </>
  );
}
