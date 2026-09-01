// ============================================================
// Transfer portal  (Yahn model v2 — roster churn factor)
// ============================================================
// CFBD /player/portal — every transfer-portal entry for a season,
// with origin, destination, and a 247-style player rating (often
// null; star rating is more complete). SP+'s preseason projection
// underweights modern portal volume, so a per-team net-talent number
// is a genuine early-season signal.
//
// Wipe + reload PortalEntry for the season, then recompute the
// per-team TeamPortalNet rollup. 1 CFBD call.
//
// Run:  npm run pull-portal
//       npm run pull-portal -- --season 2026
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { cfbdGet, seasonForDate, getCfbdCallCount } from "../lib/cfbd";
import { recordCfbdUsage } from "../lib/apiUsage";
import { buildTeamResolver } from "../lib/teamResolver";

const prisma = new PrismaClient();

interface PortalRow {
  season: number;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  origin: string | null;
  destination: string | null;
  transferDate: string | null;
  rating: number | null;
  stars: number | null;
  eligibility: string | null;
}

function parseArgs(): { season?: number } {
  const args = process.argv.slice(2);
  const i = args.indexOf("--season");
  return { season: i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined };
}

// Value OVER REPLACEMENT for one portal entry, so shedding depth pieces
// nets ~0 and only real talent moves the needle. The raw quality score is
// the 247 composite (0..1) if present, else star-derived, else replacement
// level. We then subtract replacement and floor at 0 — a below-average
// portal body leaving or arriving shouldn't swing a team's rating.
const STAR_SCORE: Record<number, number> = { 5: 0.98, 4: 0.92, 3: 0.85, 2: 0.79, 1: 0.75 };
const REPLACEMENT = 0.8; // ~low-3-star; the floor a roster refills from
function entryVOR(rating: number | null, stars: number | null): number {
  let q: number;
  if (rating != null && Number.isFinite(rating) && rating > 0) q = rating;
  else if (stars != null && STAR_SCORE[stars] != null) q = STAR_SCORE[stars];
  else q = 0.8; // unrated ≈ low-3-star
  return Math.max(0, q - REPLACEMENT);
}

const NET_CAP = 6; // clamp the per-team net so the portal can't dominate

async function main() {
  const season = parseArgs().season ?? seasonForDate();
  console.log(`Transfer portal — season ${season}\n`);

  const teams = await buildTeamResolver(prisma, "cfbd");
  const raw = await cfbdGet<PortalRow[]>(`/player/portal?year=${season}`);
  console.log(`  -> ${raw.length} portal entries from CFBD`);

  // key on the DB unique constraint (season, playerName, position, origin);
  // on a collision keep the entry that actually landed somewhere.
  const byKey = new Map<string, Prisma.PortalEntryCreateManyInput>();
  for (const r of raw) {
    const playerName = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
    if (!playerName) continue;
    const d = r.transferDate ? new Date(r.transferDate) : null;
    const row: Prisma.PortalEntryCreateManyInput = {
      season,
      playerName,
      position: r.position ?? null,
      origin: r.origin ?? null,
      originTeamId: r.origin ? teams.resolve(r.origin) : null,
      destination: r.destination ?? null,
      destTeamId: r.destination ? teams.resolve(r.destination) : null,
      rating: r.rating ?? null,
      stars: r.stars ?? null,
      eligibility: r.eligibility ?? null,
      transferDate: d && !isNaN(d.getTime()) ? d : null,
    };
    const key = `${playerName}|${r.position ?? ""}|${r.origin ?? ""}`;
    const prev = byKey.get(key);
    if (!prev || (!prev.destination && row.destination)) byKey.set(key, row);
  }
  const entries = [...byKey.values()];

  await prisma.$transaction([
    prisma.portalEntry.deleteMany({ where: { season } }),
    prisma.portalEntry.createMany({ data: entries }),
  ]);

  // ---- per-team rollup ----
  type Agg = { inC: number; outC: number; inS: number; outS: number };
  const agg = new Map<string, Agg>();
  const bump = (id: string): Agg => {
    let a = agg.get(id);
    if (!a) agg.set(id, (a = { inC: 0, outC: 0, inS: 0, outS: 0 }));
    return a;
  };
  for (const e of entries) {
    const s = entryVOR(e.rating ?? null, e.stars ?? null);
    if (e.destTeamId) {
      const a = bump(e.destTeamId);
      a.inC++;
      a.inS += s;
    }
    if (e.originTeamId) {
      const a = bump(e.originTeamId);
      a.outC++;
      a.outS += s;
    }
  }

  interface NetRow {
    teamId: string;
    season: number;
    inCount: number;
    outCount: number;
    inScore: number;
    outScore: number;
    netScore: number;
  }
  const clampNet = (x: number) => Math.max(-NET_CAP, Math.min(NET_CAP, x));
  const netRows: NetRow[] = [...agg.entries()].map(([teamId, a]) => ({
    teamId,
    season,
    inCount: a.inC,
    outCount: a.outC,
    inScore: Math.round(a.inS * 100) / 100,
    outScore: Math.round(a.outS * 100) / 100,
    netScore: Math.round(clampNet(a.inS - a.outS) * 100) / 100,
  }));

  await prisma.$transaction([
    prisma.teamPortalNet.deleteMany({ where: { season } }),
    prisma.teamPortalNet.createMany({ data: netRows }),
  ]);

  const resolvedIn = entries.filter((e) => e.destTeamId).length;
  const resolvedOut = entries.filter((e) => e.originTeamId).length;
  const topGain = [...netRows].sort((a, b) => b.netScore - a.netScore).slice(0, 5);
  const topLoss = [...netRows].sort((a, b) => a.netScore - b.netScore).slice(0, 5);
  const nameById = new Map(
    (
      await prisma.team.findMany({
        where: { id: { in: [...topGain, ...topLoss].map((r) => r.teamId) } },
        select: { id: true, canonicalName: true },
      })
    ).map((t) => [t.id, t.canonicalName])
  );

  console.log("\n============================================================");
  console.log(`PortalEntry rows:   ${entries.length} (dest resolved ${resolvedIn}, origin resolved ${resolvedOut})`);
  console.log(`TeamPortalNet rows: ${netRows.length}`);
  console.log("\n  Biggest net portal gains:");
  for (const r of topGain)
    console.log(`    ${(nameById.get(r.teamId) ?? r.teamId).padEnd(22)} +${r.netScore.toFixed(1)}  (in ${r.inCount} / out ${r.outCount})`);
  console.log("  Biggest net portal losses:");
  for (const r of topLoss)
    console.log(`    ${(nameById.get(r.teamId) ?? r.teamId).padEnd(22)} ${r.netScore.toFixed(1)}  (in ${r.inCount} / out ${r.outCount})`);
  console.log("============================================================");

  await recordCfbdUsage(prisma, getCfbdCallCount());
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
