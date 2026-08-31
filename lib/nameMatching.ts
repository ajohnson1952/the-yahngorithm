// ============================================================
// Team name matching logic
// ============================================================
// This is the fix for the class of bug we hit in Cavepicks (the
// "Louisiana" / "Louisiana Tech" problem): a naive substring check
// will match "Louisiana" against "Louisiana Tech Bulldogs" and get
// it wrong.
//
// Rule: a canonical team name only counts as a match if EVERY one
// of its words appears as a WHOLE WORD in the source name. When more
// than one canonical name satisfies that (e.g. both "Louisiana" and
// "Louisiana Tech" are valid word-subsets of "Louisiana Tech
// Bulldogs"), we prefer the MORE SPECIFIC match — the one with more
// words — since that's the one that's actually correct.
// ============================================================

export interface CanonicalTeam {
  id: string;
  canonicalName: string;
}

export interface MatchResult {
  teamId: string | null;
  canonicalName: string | null;
  confidence: "auto_matched" | "needs_review";
  candidatesConsidered: string[]; // for debugging ambiguous cases
}

/** Lowercase, strip punctuation, split into words. */
function normalize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** True if every word in `canonicalWords` appears as a whole word in `sourceWords`. */
function isFullWordSubset(canonicalWords: string[], sourceWords: Set<string>): boolean {
  return canonicalWords.every((w) => sourceWords.has(w));
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
  const sourceWords = new Set(normalize(sourceName));

  const fullMatches = canonicalTeams
    .map((team) => ({
      team,
      words: normalize(team.canonicalName),
    }))
    .filter(({ words }) => isFullWordSubset(words, sourceWords));

  if (fullMatches.length === 0) {
    return {
      teamId: null,
      canonicalName: null,
      confidence: "needs_review",
      candidatesConsidered: [],
    };
  }

  // Prefer the most specific match: the one with the most words.
  // This is what correctly picks "Louisiana Tech" over "Louisiana"
  // when matching against "Louisiana Tech Bulldogs".
  fullMatches.sort((a, b) => b.words.length - a.words.length);

  const best = fullMatches[0];
  const runnerUp = fullMatches[1];

  // If two candidates tie on word count, we can't safely auto-pick —
  // flag it for a human to look at instead of guessing.
  const isAmbiguous = runnerUp !== undefined && runnerUp.words.length === best.words.length;

  return {
    teamId: best.team.id,
    canonicalName: best.team.canonicalName,
    confidence: isAmbiguous ? "needs_review" : "auto_matched",
    candidatesConsidered: fullMatches.map((m) => m.team.canonicalName),
  };
}
