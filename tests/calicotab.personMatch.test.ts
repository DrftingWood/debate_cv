import { describe, it, expect } from 'vitest';
import { findPersonId, buildPersonIndex } from '@/lib/calicotab/personMatch';

function makeIndex(rows: Array<[string, bigint]>): Map<string, bigint> {
  return new Map(rows);
}

describe('findPersonId', () => {
  const idx = makeIndex([
    ['abhishek acharya', BigInt(1)],
    ['shaurya chandravanshi', BigInt(2)],
    ['adhipatya singh', BigInt(3)],
    ['plato', BigInt(4)], // single-token edge case
  ]);

  it('returns null for unknown names', () => {
    expect(findPersonId('Alice Wonderland', idx)).toBeNull();
  });

  it('exact-matches normalized names', () => {
    expect(findPersonId('Abhishek Acharya', idx)).toBe(BigInt(1));
    expect(findPersonId('  ABHISHEK   ACHARYA  ', idx)).toBe(BigInt(1));
    // Note: normalizePersonName strips punctuation entirely (no space
    // substitution), so "abhishek-acharya" → "abhishekacharya" and would
    // need its own fix in fingerprint.ts if/when we want to support
    // hyphen/underscore-as-separator inputs. Tracked separately.
  });

  it('matches when speaker tab adds a parenthetical (substring containment)', () => {
    // "Abhishek Acharya (IIT-B)" → norm "abhishek acharya iitb" — fuzzy
    // matcher resolves via wanted-tokens-subset-of-candidate.
    expect(findPersonId('Abhishek Acharya (IIT-B)', idx)).toBe(BigInt(1));
  });

  it('matches when speaker tab drops a middle name', () => {
    // Person "abhishek acharya" matches a tab row "Abhishek K Acharya" via
    // wanted-tokens-subset-of-candidate.
    expect(findPersonId('Abhishek K Acharya', idx)).toBe(BigInt(1));
  });

  it('matches when speaker tab uses surname-first comma form', () => {
    // "Acharya, Abhishek" → norm "acharya abhishek" — same token set,
    // different order. Token-subset-in-either-direction catches it.
    expect(findPersonId('Acharya, Abhishek', idx)).toBe(BigInt(1));
  });

  it('refuses to match a single-token candidate against a multi-token entry', () => {
    // "Abhishek" alone is too ambiguous — could be Acharya, Singh, etc.
    // The matcher returns null rather than risk a false positive.
    expect(findPersonId('Abhishek', idx)).toBeNull();
    expect(findPersonId('Acharya', idx)).toBeNull();
  });

  it('refuses fuzzy match when both sides are single-token (false-positive risk)', () => {
    // We DO want exact-string match for a single-token entry like "plato".
    expect(findPersonId('Plato', idx)).toBe(BigInt(4));
    // But "Plato Smith" should NOT fuzzy-match the single-token "plato"
    // entry — that's exactly the ambiguity we're avoiding.
    expect(findPersonId('Plato Smith', idx)).toBeNull();
  });

  it('does not collapse two distinct multi-token people who share one token', () => {
    // Sanity check: "Shaurya Acharya" must NOT match either "Abhishek
    // Acharya" or "Shaurya Chandravanshi" via the loose substring path —
    // each shares one token but the full normalized string isn't a
    // substring in either direction, and token-subset fails too.
    expect(findPersonId('Shaurya Acharya', idx)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(findPersonId('', idx)).toBeNull();
    expect(findPersonId('   ', idx)).toBeNull();
  });

  it('reuses a precomputed index without regression', () => {
    const built = buildPersonIndex(idx);
    expect(findPersonId('Abhishek Acharya', idx, built)).toBe(BigInt(1));
    expect(findPersonId('Abhishek K Acharya', idx, built)).toBe(BigInt(1));
  });
});
