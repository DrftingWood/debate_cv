/**
 * How close a name on a tab is to the signed-in user's Google profile name.
 * Used before a Gmail-found or pasted private URL is linked to the user: a
 * private URL is a credential for one person in one tournament, and the
 * owner's rule is that the registration name must match, or be quite close
 * to, the profile name. Below that the URL is held for the user to confirm.
 *
 * Three answers, from strongest evidence down:
 *   match      — the same name: case, punctuation, a parenthetical such as an
 *                institution, word order, or a dropped middle name. Stricter
 *                than the ingest matcher on purpose: that one accepts
 *                "Ann Lee" for "Ann Leeson" (substring), which is too loose to
 *                decide whether a credential belongs to someone.
 *   close      — not the same, but plausibly the same person: the surname
 *                agrees (or differs by one letter in a long surname) and the
 *                first name is an initial of the other, shares a prefix, or
 *                differs by a letter ("Abhishek" / "Abhisek" / "A.").
 *   different  — anything else, including a single bare name that does not
 *                equal the other.
 *
 * Pure and deterministic, so the thresholds are tested rather than tuned.
 */

import { normalizePersonName } from '@/lib/calicotab/fingerprint';

export type NameProximity = 'match' | 'close' | 'different';

/**
 * Drop a parenthetical, fold accents ("José" → "jose") and normalise. The
 * app's normaliser alone would drop an accented letter outright. Exported
 * for the Found tab's matcher (lib/discovery), which must agree with this
 * file on what counts as the same name.
 */
export function fold(name: string): string {
  const withoutParens = name.replace(/\([^)]*\)/g, ' ');
  return normalizePersonName(withoutParens.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

/** Levenshtein distance, giving up above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function surnameAgrees(a: string, b: string): boolean {
  if (a === b) return true;
  // One slip is allowed in a surname of five letters or more, not in a short one.
  return Math.min(a.length, b.length) >= 5 && editDistance(a, b, 1) <= 1;
}

function firstNameAgrees(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 1) return long.startsWith(short); // an initial
  if (short.length >= 3 && long.startsWith(short)) return true; // "Abhi" / "Abhishek"
  return short.length >= 4 && editDistance(a, b, 1) <= 1; // one typo
}

/**
 * Owner rule (assumptions I38): a one-word name or a double surname is never
 * trusted on shape alone. "Maria Garcia Lopez" may be Maria with the surname
 * "Garcia Lopez" or a middle name; "Abhishek" alone says almost nothing. Both
 * always go to the user to decide. Three or more words count as ambiguous
 * unless every middle word is an initial ("Abhishek K Acharya"). A hyphenated
 * surname and a surname particle ("de la Cruz", "van Dijk") also count.
 */
const SURNAME_PARTICLES = new Set([
  'de',
  'del',
  'della',
  'la',
  'las',
  'los',
  'da',
  'das',
  'do',
  'dos',
  'di',
  'van',
  'von',
  'der',
  'den',
  'bin',
  'binti',
  'al',
  'el',
  'le',
  'st',
]);

export function isAmbiguousNameShape(name: string): boolean {
  const raw = name.replace(/\([^)]*\)/g, ' ').trim();
  if (/\p{L}-\p{L}/u.test(raw.split(/[\s,]+/).slice(-1)[0] ?? '')) return true;
  // Words as typed: a hyphenated first name ("Jean-Paul") stays one word.
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => fold(t))
    .filter(Boolean);
  if (tokens.length < 2) return true; // a one-word name
  // A particle counts only when a word follows it ("de la Cruz", "van Dijk"):
  // as the last word it is the surname itself ("Li Bin", "Wang Di", "Minh Do").
  if (tokens.slice(0, -1).some((t) => SURNAME_PARTICLES.has(t))) return true;
  return tokens.length >= 3 && tokens.slice(1, -1).some((t) => t.length > 1);
}

/**
 * The answer, capped for the owner rule: an ambiguous shape on either side can
 * be at most 'close', and 'close' is never pre-ticked or linked on its own.
 */
export function nameProximity(registrationName: string, profileName: string): NameProximity {
  const p = rawProximity(registrationName, profileName);
  if (
    p === 'match' &&
    (isAmbiguousNameShape(registrationName) || isAmbiguousNameShape(profileName))
  ) {
    return 'close';
  }
  return p;
}

function rawProximity(registrationName: string, profileName: string): NameProximity {
  const a = fold(registrationName);
  const b = fold(profileName);
  if (!a || !b) return 'different';
  if (a === b) return 'match';

  const ta = a.split(' ');
  const tb = b.split(' ');
  // Same words in another order ("Acharya Abhishek", "Acharya, Abhishek").
  if (ta.length === tb.length && [...ta].sort().join(' ') === [...tb].sort().join(' '))
    return 'match';
  // A single bare name is too ambiguous to be close to anything but itself.
  if (ta.length < 2 || tb.length < 2) return 'different';
  // Same first name and surname, a middle name dropped on either side.
  if (ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]) return 'match';

  // Surname is the last token, first name the first; middle names are ignored.
  if (surnameAgrees(ta[ta.length - 1], tb[tb.length - 1]) && firstNameAgrees(ta[0], tb[0]))
    return 'close';
  // Surname-first order ("Acharya A"): compare crosswise.
  if (surnameAgrees(ta[0], tb[tb.length - 1]) && firstNameAgrees(ta[ta.length - 1], tb[0]))
    return 'close';
  if (surnameAgrees(ta[ta.length - 1], tb[0]) && firstNameAgrees(ta[0], tb[tb.length - 1]))
    return 'close';
  return 'different';
}

export type ProximityToYou = NameProximity | 'unknown';

/**
 * How a name found on one of the user's private URLs relates to who the user
 * is, judged against every name we hold for them: their Google profile name
 * and the names they have already claimed. The best answer wins, so a user who
 * plays under "Abhi A" and has claimed that name is not flagged for it. With
 * no reference name at all the answer is 'unknown', not 'different'.
 */
export function proximityToYou(
  name: string,
  references: ReadonlyArray<string | null | undefined>,
): ProximityToYou {
  const refs = references.filter((r): r is string => typeof r === 'string' && r.trim() !== '');
  if (refs.length === 0) return 'unknown';
  let best: NameProximity = 'different';
  for (const ref of refs) {
    const p = nameProximity(name, ref);
    if (p === 'match') return 'match';
    if (p === 'close') best = 'close';
  }
  return best;
}
