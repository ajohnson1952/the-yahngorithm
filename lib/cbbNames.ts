// ============================================================
// CBB team-name matching (suggestions only)
// ============================================================
// Every outside source spells teams its own way. The schedule never needs
// this (ESPN ids link teams exactly) — it's for FanDuel/Odds API, KenPom and
// Torvik names. Rule from the CBB plan: matching uses an exact, CONFIRMED
// alias. This file only SUGGESTS aliases (saved as 'needs_review'); a person
// confirms them at /cbb/admin/teams before the pipeline will use them.
//
// Pass 1: the source name equals a team's ESPN full name ("Duke Blue
//         Devils"), ignoring case/punctuation and treating St/St./State as
//         the same word. Strong.
// Pass 2: the CFB matcher (lib/nameMatching.ts) — the name starts with the
//         school name and any leftover words are that team's OWN mascot.
//         Blocks "Alabama" grabbing "North Alabama Lions".
// ============================================================

import { matchTeamName, normalize, type CanonicalTeam } from "./nameMatching";

export interface CbbMatchTeam {
  id: string;
  name: string; // our canonical name (CBBD school, or ESPN name for non-D-I)
  espnName: string | null; // ESPN display name, e.g. "Siena Saints"
}

export interface CbbSuggestion {
  teamId: string | null;
  teamName: string | null;
  how: "espn_name" | "school_mascot" | null;
  ambiguous: boolean;
}

/** Words, with "st" folded into "state" so "Arizona St" == "Arizona State". */
const fold = (s: string) =>
  normalize(s)
    .map((w) => (w === "st" ? "state" : w))
    .join(" ");

export function buildCbbMatcher(teams: CbbMatchTeam[]) {
  const byEspn = new Map<string, CbbMatchTeam[]>();
  for (const t of teams) {
    if (!t.espnName) continue;
    const k = fold(t.espnName);
    byEspn.set(k, [...(byEspn.get(k) ?? []), t]);
  }

  // For pass 2: school names in both spellings, and the mascot = whatever
  // follows the school name in ESPN's display name.
  const canon: CanonicalTeam[] = teams.map((t) => {
    const school = normalize(t.name);
    const espn = t.espnName ? normalize(t.espnName) : [];
    const mascot =
      espn.length > school.length && school.every((w, i) => espn[i] === w)
        ? espn.slice(school.length).join(" ")
        : null;
    const alt = [t.name.replace(/\bState\b/g, "St"), t.name.replace(/\bSt\.?(?=\s|$)/g, "State")];
    return { id: t.id, canonicalName: t.name, altNames: alt, mascot };
  });

  return function suggest(sourceName: string): CbbSuggestion {
    const hits = byEspn.get(fold(sourceName)) ?? [];
    if (hits.length >= 1) {
      return { teamId: hits[0].id, teamName: hits[0].name, how: "espn_name", ambiguous: hits.length > 1 };
    }
    const m = matchTeamName(sourceName, canon);
    if (m.teamId) {
      return {
        teamId: m.teamId,
        teamName: m.canonicalName,
        how: "school_mascot",
        ambiguous: m.confidence === "needs_review",
      };
    }
    return { teamId: null, teamName: null, how: null, ambiguous: false };
  };
}
