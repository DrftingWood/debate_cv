import { normalizePersonNameV2 } from '@/lib/calicotab/fingerprint';

/**
 * Matching a name from a home page's Tournament Staff block to the people in
 * that tournament's participant list.
 *
 * A match here puts a CA / core role on somebody's CV, so it is held to a
 * stricter rule than the judge-list matcher (personNameMatches, which also
 * accepts a raw substring: "Ann Lee" inside "Joann Lee"). Two outcomes:
 *
 *   exact:     the full names are equal once case, diacritics, punctuation and
 *              spacing are folded, both have two words or more, and exactly
 *              one person in the list has that name. Only this links.
 *   candidate: every word of the shorter name is a whole word of the longer
 *              one ("Rahul Sharma" and "Rahul Kumar Sharma", or the words in
 *              another order), and exactly one person qualifies. Kept for an
 *              admin to confirm; it has no effect on any CV.
 *
 * A single word never matches, nor does a name two people share: crediting
 * the wrong "Rahul Sharma" would put the role on a stranger.
 */

export type StaffPerson = { personId: bigint; displayName: string };
export type StaffMatch = { exact: bigint | null; candidate: bigint | null };

/** The folded words of a name. */
export function nameWords(name: string): string[] {
  return normalizePersonNameV2(name).split(' ').filter(Boolean);
}

/** The one personId in `ids`, or null when there are none or several. */
function onlyOne(ids: Iterable<bigint>): bigint | null {
  const unique = [...new Set(ids)];
  return unique.length === 1 ? unique[0] : null;
}

/** Whether every word of the shorter word list is a word of the longer one. */
function sharesAllWords(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const words = new Set(long);
  return short.every((w) => words.has(w));
}

export function matchStaffName(name: string, people: readonly StaffPerson[]): StaffMatch {
  const words = nameWords(name);
  if (words.length < 2) return { exact: null, candidate: null };
  const folded = words.join(' ');
  const same = people.filter((p) => nameWords(p.displayName).join(' ') === folded);
  // Two people with this name: nobody is credited and nobody is suggested.
  if (same.length > 0) return { exact: onlyOne(same.map((p) => p.personId)), candidate: null };
  const near = people.filter((p) => {
    const theirs = nameWords(p.displayName);
    return theirs.length >= 2 && sharesAllWords(words, theirs);
  });
  return { exact: null, candidate: onlyOne(near.map((p) => p.personId)) };
}
