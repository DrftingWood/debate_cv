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

export function nameProximity(registrationName: string, profileName: string): NameProximity {
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
