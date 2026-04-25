/**
 * Debate format derived from a team's speaker count.
 *
 * British Parliamentary teams seat 2 speakers; Asian Parliamentary (and
 * World Schools) teams seat 3. Other counts are returned as 'unknown'
 * rather than guessed — callers can layer additional signals (tournament
 * name keywords, governing-body abbreviations) on top.
 */
export type DebateFormat =
  | 'British Parliamentary'
  | 'Asian Parliamentary'
  | 'unknown';

/**
 * Map a team's member count to a debate format.
 *
 *   2  → "British Parliamentary"
 *   3  → "Asian Parliamentary"
 *   anything else (incl. NaN, negative, non-integer) → "unknown"
 *
 * Pure / side-effect free / safe to call with arbitrary input.
 */
export function detectFormatFromTeamSize(teamMemberCount: number): DebateFormat {
  if (typeof teamMemberCount !== 'number') return 'unknown';
  if (!Number.isFinite(teamMemberCount)) return 'unknown';
  if (!Number.isInteger(teamMemberCount)) return 'unknown';
  if (teamMemberCount < 0) return 'unknown';
  if (teamMemberCount === 2) return 'British Parliamentary';
  if (teamMemberCount === 3) return 'Asian Parliamentary';
  return 'unknown';
}
