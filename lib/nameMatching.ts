// ============================================================
// Team name matching logic
// ============================================================
// This is the fix for the class of bug we hit in Cavepicks (the
// "Louisiana" / "Louisiana Tech" problem), plus its mirror image:
// a big FBS program silently swallowing a DIFFERENT school whose
// name happens to contain it ("Alabama" grabbing "North Alabama
// Lions", "Indiana" grabbing "Indiana State Sycamores").
//
// The rule, using the fact that CFBD gives us each team's school
// name(s) AND its mascot:
//
//   A source name (e.g. The Odds API's "Louisiana Tech Bulldogs")
//   matches a canonical team T only if:
//     1. the source name STARTS WITH one of T's known names
//        ("Louisiana Tech", or a CFBD alternateName), matched on
//        whole-word boundaries, AND
//     2. every leftover word after that is one of T's OWN mascot
//        words ("Bulldogs").
//
// So "Alabama Crimson Tide" matches Alabama (leftover "crimson
// tide" == Alabama's mascot), but "North Alabama Lions" does not
// (doesn't start with "Alabama"), and "Indiana State Sycamores"
// does not match Indiana (leftover "state sycamores" isn't
// Indiana's mascot "Hoosiers").
//
// When two of T's names could match, the longer/more specific one
// wins ("Louisiana Tech" over "Louisiana").
// ============================================================

export interface CanonicalTeam {
  id: string;
  canonicalName: string;
  /** CFBD alternateNames for this team, e.g. ["Appalachian State", "App State"]. */
  altNames?: string[];
  /** CFBD mascot for this team, e.g. "Crimson Tide". */
  mascot?: string | null;
}

export interface MatchResult {
  teamId: string | null;
  canonicalName: string | null;
  confidence: "auto_matched" | "needs_review";
  candidatesConsidered: string[]; // for debugging ambiguous cases
}

/**
 * Lowercase, fold accents (José -> jose), strip punctuation, split into words.
 * Accent folding matters because CFBD writes "San José State" while The Odds
 * API writes "San Jose State" — same school, and we don't want that to be a miss.
 */
export function normalize(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks (é -> e)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Pure abbreviations like "ALA", "SJSU" — drop these as match targets. */
function isAbbreviation(name: string): boolean {
  return /^[A-Z0-9]{2,5}$/.test(name.trim());
}

/** True if `prefix` is exactly the leading run of words in `words`. */
function isWordPrefix(prefix: string[], words: string[]): boolean {
  if (prefix.length === 0 || prefix.length > words.length) return false;
  return prefix.every((w, i) => words[i] === w);
}

interface Candidate {
  team: CanonicalTeam;
  matchedNameLength: number; // # of words in the name that matched (specificity)
}

/**
 * Given one name as it appears in an external source (e.g. The Odds API's
 * "Louisiana Tech Bulldogs"), find the best-matching canonical team from
 * CFBD's team list.
 */
export function matchTeamName(
  sourceName: string,
  canonicalTeams: CanonicalTeam[]
): MatchResult {
  const sourceWords = normalize(sourceName);
  const candidates: Candidate[] = [];

  for (const team of canonicalTeams) {
    const mascotWords = new Set(normalize(team.mascot ?? ""));

    // Every name we'd accept for this team: its canonical name (always —
    // even when it IS an abbreviation, like "LSU" or "UCF"), plus CFBD
    // alternate names with pure abbreviations dropped ("APP", "SHSU" are
    // no use for matching feed names and risk colliding with short words).
    const names = [
      team.canonicalName,
      ...(team.altNames ?? []).filter((n) => n && !isAbbreviation(n)),
    ].filter(Boolean);

    let bestNameLen = 0;
    for (const name of names) {
      const nameWords = normalize(name);
      if (!isWordPrefix(nameWords, sourceWords)) continue;

      const leftover = sourceWords.slice(nameWords.length);
      const leftoverIsAllMascot = leftover.every((w) => mascotWords.has(w));
      if (!leftoverIsAllMascot) continue;

      bestNameLen = Math.max(bestNameLen, nameWords.length);
    }

    if (bestNameLen > 0) {
      candidates.push({ team, matchedNameLength: bestNameLen });
    }
  }

  if (candidates.length === 0) {
    return {
      teamId: null,
      canonicalName: null,
      confidence: "needs_review",
      candidatesConsidered: [],
    };
  }

  // Prefer the most specific match (longest matched name).
  candidates.sort((a, b) => b.matchedNameLength - a.matchedNameLength);
  const best = candidates[0];
  const runnerUp = candidates[1];

  const isAmbiguous =
    runnerUp !== undefined &&
    runnerUp.matchedNameLength === best.matchedNameLength &&
    runnerUp.team.id !== best.team.id;

  return {
    teamId: best.team.id,
    canonicalName: best.team.canonicalName,
    confidence: isAmbiguous ? "needs_review" : "auto_matched",
    candidatesConsidered: candidates.map((c) => c.team.canonicalName),
  };
}
