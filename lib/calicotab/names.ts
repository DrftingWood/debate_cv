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
 * Stand-ins, matched against the NORMALISED name (lower case, punctuation
 * stripped, "." "-" "_" "/" read as spaces). Every shape below is from a
 * real corpus tab or an older normalisation of one.
 *
 *   "Speaker 1", "Speaker 2.2", "Speaker 1A", "Speaker B", "Speaker II",
 *   "Orador C2", "Swing B", "Swing Speaker 1", "Swinging partner 2",
 *   "Iron 1", "Judge 1", "Speaker", "Swing 1b (Please don't give speaker
 *   points)", "Swing mcswingface 2", "SwingB" (glued by an older
 *   normaliser), "Placeholder (do not assign a speaker score)", "Invalid",
 *   "TBA", "N/A", a bare number,
 *
 * and the opt-out renderings "<em>Redacted</em>", "Redacted 3" and
 * "Anonymous". Those are real people who asked not to be named — but as a
 * Person row every one of them at every tournament is the SAME row, so they
 * are nobody's too. (lib/calicotab/redactedSpeaker.ts still attributes a
 * redacted row to its owner when the team makes it unambiguous.)
 *
 * Normalised, "Speaker 2" alone sat on 53 speaker tabs as one claimable
 * "debater".
 *
 * Exported as a string because migration 20260915000000 and the daily prune
 * run this exact pattern in Postgres, and a test holds them together. It is
 * written in the regex subset JavaScript and Postgres read identically.
 */
const STAND_IN_WORD = 'speaker|orador|oradora|debater|member|participant|partner|judge|adjudicator|iron|swing';
const STAND_IN_ID = '(?:[0-9]+[a-z]?|[a-z][0-9]*|[ivx]+|one|two|three|four|five)';
const REDACTED = '(?:em ?)?redacted(?: em)?(?: [0-9]+)?|anonymous(?: [0-9]+)?';

export const PLACEHOLDER_NAME_PATTERN =
  '^(?:[io] )?(?:' +
  [
    `(?:swing(?:ing)? )?(?:${STAND_IN_WORD})(?: ${STAND_IN_ID}){0,3}(?: (?:please|do not|dont) .*)?`,
    'swing[a-z]*(?: [a-z]+)? [0-9]+[a-z]?(?: .*)?',
    '(?:swing|speaker|orador|iron)(?:[a-z]|[0-9]+[a-z]?)',
    'placeholder.*',
    REDACTED,
    'invalid|tba|tbd|tbc|n a|dummy(?: [0-9]+)?',
    '[0-9]+(?: [0-9]+)*',
  ].join('|') +
  ')$';

const PLACEHOLDER = new RegExp(PLACEHOLDER_NAME_PATTERN);
const REDACTED_ONLY = new RegExp(`^(?:[io] )?(?:${REDACTED})$`);

/**
 * normalizePersonName keeps only a-z and 0-9, so a name in any other script
 * collapses — "Iron Ли" to "iron", "王欣月2" to "2" — into a stand-in shape.
 * A stand-in is typed in ASCII; anything else is somebody's name.
 */
const ASCII_ONLY = /^[ -~]*$/;

function normalisedIfAscii(name: string): string | null {
  const raw = stripAttendanceTag(name.trim());
  if (!ASCII_ONLY.test(raw)) return null;
  const normalized = normalizePersonName(raw);
  return normalized === '' ? null : normalized;
}

export function isPlaceholderPersonName(name: string): boolean {
  const normalized = normalisedIfAscii(name);
  return normalized != null && PLACEHOLDER.test(normalized);
}

/** An opted-out speaker's rendering ("<em>Redacted</em>", "Anonymous"). */
export function isRedactedName(name: string): boolean {
  const normalized = normalisedIfAscii(name);
  return normalized != null && REDACTED_ONLY.test(normalized);
}
