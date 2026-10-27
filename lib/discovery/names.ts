/**
 * Names for the Found tab: which of a user's names are searched, and the
 * exact stored key each one is searched by.
 *
 * Exact matching (the owner's decision, 2026-10-27): a name on a public tab
 * is a candidate when its WHOLE stored key EQUALS the key of one of the
 * user's claimed names, or, for a name of two or more words only, when it
 * holds every word of that name in order (`aliasPattern`). No near
 * spellings, no partial words, no reordering, no similarity. The key is the one
 * every Person row is stored under (`normalizePersonName`, the v1 normaliser:
 * lower case, accented letters dropped, punctuation stripped, and any run of
 * whitespace, including a non-breaking space, collapsed to one space and
 * trimmed), so the lookup is an equality on `Person.normalizedName`'s unique
 * btree.
 *
 * Pure. The loader does the lookup in one query.
 */

import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { isPlaceholderPersonName, isRedactedName } from '@/lib/calicotab/names';

/**
 * More names than this is unusual enough that the rest wait; the page says
 * how many were left out. Equality probes are cheap, so this is generous.
 */
export const MAX_ALIASES = 20;

/** A name that is a stand-in ("Swing 2", "TBA") or an opted-out redaction. */
export function isStandInName(name: string): boolean {
  return isPlaceholderPersonName(name) || isRedactedName(name);
}

/**
 * The stored key for a name. `normalizePersonName` already turns every
 * whitespace run (`\s` includes U+00A0) into one space and trims; the
 * explicit NBSP replace keeps that true even if the normaliser changes.
 */
export function aliasKey(name: string): string {
  return normalizePersonName(name.replace(/ /g, ' '));
}

export type Alias = { name: string; key: string };

function escapeRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The one near match the owner allows (2026-10-27), for a name of two or
 * more words only: every word of the alias, as a WHOLE word, IN ORDER, with
 * any other words allowed before, between and after. "abhishek acharya"
 * finds "dr abhishek acharya", "abhishek acharya iitb" and "abhishek
 * lalatendu acharya", never "acharya abhishek", "abhishekh acharya",
 * "abhishek acharyaa" or a name missing one of the words.
 *
 * Shape: `(^| )w1( .*)? w2( .*)? w3( |$)`. Stored keys hold only a-z, 0-9
 * and single spaces, so this reads the same in JavaScript and in Postgres
 * (`~`); the words are escaped anyway, and the pattern is always passed as a
 * bound parameter. A one-word alias gets no pattern: it matches only by
 * whole-name equality.
 */
export function aliasPattern(key: string): string | null {
  const words = key.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  return `(^| )${words.map(escapeRegex).join('( .*)? ')}( |$)`;
}

export type AliasSelection = {
  /** Names searched, one per distinct key, at most MAX_ALIASES. */
  aliases: Alias[];
  /** Names that normalise to nothing (fully non-Latin): unsearchable for now. */
  unsearchable: number;
  /** Names past MAX_ALIASES. */
  overLimit: number;
};

/**
 * The user's claimed names, deduplicated by stored key. Stand-ins are never
 * searched. A one-word name IS searched, and like every alias it matches only
 * a stored name that is exactly that key in full: "abhishek" finds the
 * Person "abhishek", never "abhishek sharma". A one-word name can still have
 * many exact hits, which the per-name cap and its visible note handle.
 */
export function selectAliases(names: readonly string[]): AliasSelection {
  const byKey = new Map<string, string>();
  let unsearchable = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (!name || isStandInName(name)) continue;
    const key = aliasKey(name);
    if (!key) {
      unsearchable += 1;
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, name);
  }
  const all = [...byKey.entries()]
    .map(([key, name]) => ({ name, key }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    aliases: all.slice(0, MAX_ALIASES),
    unsearchable,
    overLimit: Math.max(0, all.length - MAX_ALIASES),
  };
}
