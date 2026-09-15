import { normalizePersonName } from './fingerprint';

/**
 * Names as tabs print them are not always names.
 *
 * Two things ride along with real names in scraped cells, and both used to
 * reach Person rows.
 */

/**
 * An attendance tag in front of a name: "[o] Vladimira Suflaj", "[i] ANU 1".
 * A hybrid tournament marks who attended online and who in person, and the
 * tag is printed on adjudicators, teams and team columns but NOT on the
 * speaker tab — so the same team was "[o] MAD A" on one page and "MAD A" on
 * another, and a tagged judge could not match their untagged record
 * anywhere else. One lowercase letter only: "[REDACTED]" is a whole name,
 * not a tag, and is left alone.
 */
const ATTENDANCE_TAG = /^\[[a-z]\]\s+(?=\S)/;

export function stripAttendanceTag(name: string): string {
  return name.replace(ATTENDANCE_TAG, '');
}

/**
 * A stand-in an organiser typed in place of a person, matched against the
 * NORMALISED name (lower case, punctuation stripped, "." -> space).
 *
 * "Speaker 1", "Speaker 2.2", "Speaker 1A", "Orador C2", "Swing B", "Iron 1",
 * "Debater 1", a bare "Speaker", "Placeholder (do not assign a speaker
 * score)", "Invalid", a bare number. Across 625 tournaments "Speaker 2"
 * alone appeared on 53 speaker tabs. Normalised to one Person each, every
 * one of those became a single "debater" with dozens of tournaments, and a
 * claimable one.
 *
 * Exported as a string because the migration that removed the existing rows
 * (20260915000000_remove_placeholder_persons) uses this exact pattern, and a
 * test holds the two together. It is written in the subset of regex syntax
 * JavaScript and Postgres read identically.
 */
export const PLACEHOLDER_NAME_PATTERN =
  '^(?:(?:speaker|orador|oradora|debater|swing|iron|member|participant)(?: ?[a-z]?[0-9]+(?: [0-9]+)?[a-z]?| [a-z])?|placeholder(?: .*)?|invalid|tba|tbd|[0-9]+)$';

const PLACEHOLDER = new RegExp(PLACEHOLDER_NAME_PATTERN);

export function isPlaceholderPersonName(name: string): boolean {
  const normalized = normalizePersonName(stripAttendanceTag(name.trim()));
  return normalized !== '' && PLACEHOLDER.test(normalized);
}
