// ============================================================
// Resolve an external team name -> our Team.id
// ============================================================
// Every pipeline script that ingests data keyed by team name needs
// this. It leans on the alias table we built in matchTeamAliases.ts:
// look the name up among a source's stored aliases, fall back to the
// canonical name. A name that doesn't resolve is returned as null so
// the caller can report it rather than silently attach data to the
// wrong team (the whole point of the alias table).
// ============================================================

import type { PrismaClient } from "@prisma/client";

export type AliasSource = "cfbd" | "odds_api" | "espn";

export interface TeamResolver {
  resolve: (name: string) => string | null;
  /** Teach the resolver a name->id mapping created during this run (e.g. a
   *  newly-inserted non-FBS opponent), so later lookups in the same run hit. */
  register: (name: string, teamId: string, opts?: { fbs?: boolean }) => void;
  /** canonicalName by Team.id, for reporting. */
  canonicalById: Map<string, string>;
  /** Team.ids where classification === 'fbs' — the teams we rate and predict. */
  fbsTeamIds: Set<string>;
}

export async function buildTeamResolver(
  prisma: PrismaClient,
  source: AliasSource
): Promise<TeamResolver> {
  const [aliases, teams] = await Promise.all([
    prisma.teamSourceAlias.findMany({
      where: { source },
      select: { sourceName: true, teamId: true },
    }),
    prisma.team.findMany({
      select: { id: true, canonicalName: true, classification: true },
    }),
  ]);

  const idByName = new Map<string, string>();
  for (const t of teams) idByName.set(t.canonicalName, t.id);
  // aliases win over the canonical-name fallback
  for (const a of aliases) idByName.set(a.sourceName, a.teamId);

  const canonicalById = new Map(teams.map((t) => [t.id, t.canonicalName]));
  const fbsTeamIds = new Set(
    teams.filter((t) => t.classification === "fbs").map((t) => t.id)
  );

  return {
    resolve: (name: string) => idByName.get(name) ?? null,
    register: (name: string, teamId: string, opts?: { fbs?: boolean }) => {
      idByName.set(name, teamId);
      if (!canonicalById.has(teamId)) canonicalById.set(teamId, name);
      if (opts?.fbs) fbsTeamIds.add(teamId);
    },
    canonicalById,
    fbsTeamIds,
  };
}
