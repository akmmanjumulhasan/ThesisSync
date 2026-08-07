/**
 * Module 1 (Member 2): Unified Matchmaking Engine
 *
 * A single, explainable scoring model powers both modes:
 *  - Supervisor mode: research-keyword relevance + remaining capacity + response speed.
 *  - Teammate mode: skill/language overlap, ranked with GitHub activity as a tiebreaker.
 *
 * Matching is token-based (not exact-substring) so "low-resource NLP" still lines
 * up against a supervisor's "NLP" interest, and light stemming ("graphs" -> "graph")
 * keeps plurals from silently missing a match.
 */

function stem(token: string): string {
  return token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+.#]+/)
    .filter(Boolean)
    .map(stem);
}

/** Splits a comma-separated free-text field (e.g. "NLP, graph ML, HCI") into clean terms. */
export function parseCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SupervisorMatchInput {
  researchInterests: string[];
  maxLoad: number;
  activeLoad: number;
  avgResponseDays: number;
}

export interface SupervisorMatchResult {
  fitScore: number; // 0-100, blended with capacity/response-speed, used for student-facing ranking
  relevance: number; // 0-1, pure keyword relevance, no capacity/speed mixed in
  matchedInterests: string[];
  availableSlots: number;
  isAtCapacity: boolean;
}

export function scoreSupervisor(
  studentKeywords: string[],
  supervisor: SupervisorMatchInput
): SupervisorMatchResult {
  const studentTokens = new Set(studentKeywords.flatMap(tokenize));
  const matchedInterests: string[] = [];
  let tokenHits = 0;
  let totalTokens = 0;

  for (const interest of supervisor.researchInterests) {
    const tokens = tokenize(interest);
    totalTokens += tokens.length;
    const hits = tokens.filter((t) => studentTokens.has(t)).length;
    if (hits > 0) {
      matchedInterests.push(interest);
      tokenHits += hits;
    }
  }

  const interestCoverage = supervisor.researchInterests.length
    ? matchedInterests.length / supervisor.researchInterests.length
    : 0;
  const tokenOverlap = totalTokens ? tokenHits / totalTokens : 0;
  const relevance = interestCoverage * 0.6 + tokenOverlap * 0.4;

  const availableSlots = Math.max(0, supervisor.maxLoad - supervisor.activeLoad);
  const capacityRatio = supervisor.maxLoad > 0 ? availableSlots / supervisor.maxLoad : 0;
  const speedRatio = Math.max(0, Math.min(1, 1 - supervisor.avgResponseDays / 7));

  const raw = relevance * 0.7 + capacityRatio * 0.18 + speedRatio * 0.12;
  const fitScore = Math.round(Math.max(0, Math.min(1, raw)) * 100);

  return {
    fitScore,
    relevance,
    matchedInterests,
    availableSlots,
    isAtCapacity: availableSlots <= 0,
  };
}

export interface TeammateCandidateInput {
  topLanguages: string[];
  declaredSkills: string[];
  totalCommits: number;
}

export interface TeammateMatchResult {
  matchedSkills: string[];
  overlapCount: number;
  rank: number; // sort key only, overlap dominates, commit activity just breaks ties
}

/** A candidate only belongs in results if overlapCount > 0. No overlap, no match. */
export function scoreTeammate(studentSkills: string[], candidate: TeammateCandidateInput): TeammateMatchResult {
  const skillTokens = new Set(studentSkills.flatMap(tokenize));
  const candidateSkills = [...new Set([...candidate.topLanguages, ...candidate.declaredSkills])];
  const matchedSkills = candidateSkills.filter((skill) => tokenize(skill).some((t) => skillTokens.has(t)));

  return {
    matchedSkills,
    overlapCount: matchedSkills.length,
    rank: matchedSkills.length * 1000 + candidate.totalCommits,
  };
}
