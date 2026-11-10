// npm run cbb:pull-games [-- --days-back 1 --days-ahead 2]
//
// Pulls the CBB schedule + scores from ESPN's free scoreboard (no key, no
// quota) for a window of Central-time dates — default yesterday through two
// days out — and upserts CbbGame rows by ESPN game id.
//
// Teams are matched by ESPN team id, never by name. A non-D-I opponent
// (D-II, NAIA, ...) that isn't in the table yet is created on the spot with
// division 'non_d1', so those games and their lines can still be stored.

import { PrismaClient } from "@prisma/client";
import { cbbSeason, centralYmd, fetchCbbScoreboard, type EspnCbbTeam } from "../../lib/espnCbb";

const prisma = new PrismaClient();

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}

async function main() {
  const back = arg("days-back", 1);
  const ahead = arg("days-ahead", 2);

  // One small read: every team's espnId -> our id (~400-500 rows, 2 columns).
  const teams = await prisma.cbbTeam.findMany({
    where: { espnId: { not: null } },
    select: { id: true, espnId: true },
  });
  if (teams.length === 0) {
    console.log("No CBB teams yet — run `npm run cbb:seed-teams` first.");
    return;
  }
  const byEspn = new Map(teams.map((t) => [t.espnId!, t.id]));

  const teamId = async (t: EspnCbbTeam): Promise<string> => {
    const hit = byEspn.get(t.espnId);
    if (hit) return hit;
    // New non-D-I opponent. Name = ESPN's display name; fall back to adding
    // the id if that name is somehow taken.
    const base = { division: "non_d1", espnId: t.espnId, abbreviation: t.abbreviation, logo: t.logo, color: t.color };
    const created = await prisma.cbbTeam
      .create({ data: { ...base, name: t.displayName } })
      .catch(() => prisma.cbbTeam.create({ data: { ...base, name: `${t.displayName} (${t.espnId})` } }));
    await prisma.cbbTeamAlias.upsert({
      where: { source_alias: { source: "espn", alias: t.displayName } },
      update: {},
      create: { source: "espn", alias: t.displayName, teamId: created.id, confidence: "confirmed" },
    });
    byEspn.set(t.espnId, created.id);
    console.log(`  + non-D-I team: ${t.displayName}`);
    return created.id;
  };

  let total = 0;
  for (let off = -back; off <= ahead; off++) {
    const ymd = centralYmd(new Date(Date.now() + off * 86_400_000));
    const games = await fetchCbbScoreboard(ymd);
    for (const g of games) {
      const data = {
        season: cbbSeason(g.startTime),
        startTime: g.startTime,
        homeTeamId: await teamId(g.home),
        awayTeamId: await teamId(g.away),
        neutralSite: g.neutralSite,
        status: g.status,
        homeScore: g.home.score,
        awayScore: g.away.score,
      };
      await prisma.cbbGame.upsert({
        where: { espnId: g.espnId },
        update: data,
        create: { ...data, espnId: g.espnId },
      });
    }
    const finals = games.filter((g) => g.status === "final").length;
    console.log(`${ymd}: ${games.length} games (${finals} final)`);
    total += games.length;
  }
  console.log(`Done — ${total} games upserted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
