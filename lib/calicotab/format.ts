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
/**
 * Short display code for a stored `Tournament.format` string.
 *
 * The ledger prints the format on every row, and "British Parliamentary"
 * is 22 characters for a value that repeats down the whole column and is
 * the same for most debaters' entire record. Spelled out it was the third
 * widest column on the table and pushed the ledger past the viewport at
 * 1440px; as "BP" it costs a fifth of that. Callers must put the full
 * string in a `title` so the abbreviation stays hoverable — an unfamiliar
 * code with no way to expand it is worse than a wide column.
 *
 * Formats come from `detectFormatFromTeamSize` and from the tournament-name
 * keyword pass in lib/calicotab/ingest.ts, so the table below covers both
 * vocabularies. Anything unrecognised passes through unchanged rather than
 * being truncated — a novel format should read oddly, not wrongly.
 */
const FORMAT_ABBREV: Record<string, string> = {
  'british parliamentary': 'BP',
  'asian parliamentary': 'AP',
  'world schools': 'WSDC',
  'lincoln-douglas': 'LD',
  'public forum': 'PF',
  policy: 'Policy',
};

export function formatAbbrev(format: string | null | undefined): string | null {
  if (!format) return null;
  const trimmed = format.trim();
  if (!trimmed) return null;
  return FORMAT_ABBREV[trimmed.toLowerCase()] ?? trimmed;
}

export function detectFormatFromTeamSize(teamMemberCount: number): DebateFormat {
  if (typeof teamMemberCount !== 'number') return 'unknown';
  if (!Number.isFinite(teamMemberCount)) return 'unknown';
  if (!Number.isInteger(teamMemberCount)) return 'unknown';
  if (teamMemberCount < 0) return 'unknown';
  if (teamMemberCount === 2) return 'British Parliamentary';
  if (teamMemberCount === 3) return 'Asian Parliamentary';
  return 'unknown';
}
