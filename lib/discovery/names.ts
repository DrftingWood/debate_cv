/**
 * Names for the Found tab: which of a user's names may seed a search, which
 * stored names to look up for each, and how close a listed name is.
 *
 * Pure. The loader turns `lookupKeys` and `prefixRanges` into index probes on
 * `Person.normalizedName` (its unique btree), so a search never reads the
 * whole Person table; `classifyName` then decides, in memory, which of the
 * rows that came back are worth showing.
 */

import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { isPlaceholderPersonName, isRedactedName } from '@/lib/calicotab/names';
import { fold, nameProximity, proximityToYou } from '@/lib/identity/nameProximity';

/** How a listed name relates to one of the user's anchor names. */
export type MatchProximity = 'match' | 'close' | 'ambiguous';

/**
 * The spec allows at most five anchors per user without an admin review
 * (section 5.3); more than that is unusual enough to be worth a look.
 */
export const MAX_ANCHORS = 5;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function deletions(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) out.push(word.slice(0, i) + word.slice(i + 1));
  return out;
}

/** Every string one edit away: delete, swap neighbours, replace, insert (a-z). */
function singleEdits(word: string): string[] {
  const out = deletions(word);
  for (let i = 0; i + 1 < word.length; i++) {
    out.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  for (let i = 0; i <= word.length; i++) {
    for (const c of LETTERS) {
      if (i < word.length && c !== word[i]) out.push(word.slice(0, i) + c + word.slice(i + 1));
      out.push(word.slice(0, i) + c + word.slice(i));
    }
  }
  return out;
}

/**
 * The `Person.normalizedName` values to probe exactly for one anchor.
 *
 * Stored keys are the v1 normaliser's output, which DELETES accented letters
 * ("José" is stored as "jos"), so the anchor's v1 key and its folded key are
 * both probed, and so are the one-letter deletions that an accent costs. The
 * rest mirror what `nameProximity` calls close: an initial, a shortened first
 * name, a one-letter slip in either name, surname-first order, and the first
 * two words of a three-word name (a double surname).
 *
 * Bounded by construction: about a thousand keys for a long two-word name,
 * each one an index probe. Middle names on the LISTED side cannot be
 * enumerated; `prefixRanges` covers those.
 */
export function lookupKeys(anchor: string): string[] {
  const keys = new Set<string>();
  const v1 = normalizePersonName(anchor);
  const folded = fold(anchor);
  if (v1) keys.add(v1);
  if (folded) keys.add(folded);
  const tokens = folded.split(' ').filter(Boolean);
  if (tokens.length < 2) return [...keys];

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const add = (f: string, l: string) => {
    if (f && l) keys.add(`${f} ${l}`);
  };
  add(first, last);
  add(last, first);
  add(first[0], last);
  add(last, first[0]);
  if (tokens.length >= 3) add(first, tokens[tokens.length - 2]);
  for (let n = 3; n < first.length; n++) add(first.slice(0, n), last);
  for (const f of first.length >= 4 ? singleEdits(first) : deletions(first)) add(f, last);
  for (const l of last.length >= 5 ? singleEdits(last) : deletions(last)) add(first, l);
  return [...keys];
}

/** The smallest string that sorts after every string starting with `prefix`. */
function upperBound(prefix: string): string | null {
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c >= 'a' && c < 'z') return prefix.slice(0, i) + String.fromCharCode(c.charCodeAt(0) + 1);
  }
  return null;
}

export type PrefixRange = { gte: string; lt: string };

/**
 * Key ranges that hold every stored name starting with the anchor's first
 * name or its surname: "abhishek kumar sharma" for "Abhishek Sharma", and
 * "sharma abhishek" for tabs that list the surname first.
 *
 * A range on the btree, not `LIKE 'x%'`: LIKE can only use the index under
 * the C collation, while `>= 'abhishek' AND < 'abhishel'` can under any
 * collation, because stored keys hold only a-z, 0-9 and spaces. Tokens of
 * fewer than three letters are skipped (an initial would read thousands of
 * rows); the loader caps each range anyway.
 */
export function prefixRanges(anchor: string): PrefixRange[] {
  const v1 = normalizePersonName(anchor).split(' ').filter(Boolean);
  const folded = fold(anchor).split(' ').filter(Boolean);
  const tokens = new Set<string>();
  for (const t of [v1[0], folded[0], v1[v1.length - 1], folded[folded.length - 1]]) {
    if (t && t.length >= 3 && /^[a-z]+$/.test(t)) tokens.add(t);
  }
  const ranges: PrefixRange[] = [];
  for (const t of tokens) {
    const lt = upperBound(t);
    if (lt) ranges.push({ gte: t, lt });
  }
  return ranges;
}

function sameWords(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
}

/**
 * How `listed` (a name on a public tab) relates to `anchor` (a name the user
 * registered under), or null when it is not worth showing.
 *
 * `ambiguous` is the owner's rule that one-word names and double surnames
 * always go to the user: "Ana García López" against "Ana García" (or the
 * reverse), and a three-word name against a two-word one with the same first
 * and last word, could be one person with a middle name or two people with
 * different surnames. Neither side can tell, so neither is ever bulk-added.
 */
export function classifyName(anchor: string, listed: string): MatchProximity | null {
  const a = fold(anchor);
  const b = fold(listed);
  if (!a || !b) return null;
  const ta = a.split(' ');
  const tb = b.split(' ');
  if (ta.length < 2 || tb.length < 2) return a === b ? 'ambiguous' : null;
  if (sameWords(ta, tb)) return 'match';

  if (ta.length !== tb.length && Math.max(ta.length, tb.length) >= 3 && ta[0] === tb[0]) {
    const [short, long] = ta.length < tb.length ? [ta, tb] : [tb, ta];
    if (long.slice(1).includes(short[short.length - 1])) return 'ambiguous';
  }
  const p = nameProximity(anchor, listed);
  return p === 'different' ? null : p;
}

/** The strongest relation of `listed` to any anchor, and which anchor gave it. */
export function bestMatch(
  anchors: readonly string[],
  listed: string,
): { proximity: MatchProximity; anchor: string } | null {
  const rank: Record<MatchProximity, number> = { match: 3, close: 2, ambiguous: 1 };
  let best: { proximity: MatchProximity; anchor: string } | null = null;
  for (const anchor of anchors) {
    const p = classifyName(anchor, listed);
    if (p && (!best || rank[p] > rank[best.proximity])) best = { proximity: p, anchor };
  }
  return best;
}

/** A name that is a stand-in ("Swing 2", "TBA") or an opted-out redaction. */
export function isStandInName(name: string): boolean {
  return isPlaceholderPersonName(name) || isRedactedName(name);
}

export type AnchorSelection = {
  /** Names that may seed a search, at most MAX_ANCHORS. */
  usable: string[];
  /**
   * Names held back for an admin check: a forwarded private URL whose
   * registration name is unlike every other name the user has, or anchors
   * past the cap. Counted, never shown to the user.
   */
  heldBack: number;
  /** Names that fold to nothing (fully non-Latin): unsearchable before option B. */
  unsearchable: number;
};

/**
 * Pick the anchors from the registration names on the user's own ingested
 * private URLs (never the Google name or a typed name: the owner's rule).
 *
 * The Google name is used only as a reference for the forwarded-URL check: a
 * teammate who forwards their private URL hands the user a registration card
 * with the teammate's name on it. An anchor that is `different` from every
 * other anchor AND from the Google name is held back until an admin looks.
 * With nothing to compare against (one anchor, no Google name) it is held
 * back too: that is exactly the shape of a new account built on one
 * forwarded URL.
 */
export function selectAnchors(
  registrationNames: readonly string[],
  googleName: string | null | undefined,
): AnchorSelection {
  const byKey = new Map<string, string>();
  let unsearchable = 0;
  for (const raw of registrationNames) {
    const name = raw.trim();
    if (!name || isStandInName(name)) continue;
    const key = fold(name);
    if (!key) {
      unsearchable += 1;
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, name);
  }
  const names = [...byKey.values()].sort((x, y) => x.localeCompare(y));
  const vetted = names.filter((name) => {
    const p = proximityToYou(name, [...names.filter((n) => n !== name), googleName]);
    return p === 'match' || p === 'close';
  });
  const usable = vetted.slice(0, MAX_ANCHORS);
  return { usable, heldBack: names.length - usable.length, unsearchable };
}
