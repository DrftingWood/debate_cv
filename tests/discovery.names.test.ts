/**
 * Exact aliases for the Found tab: the stored key each claimed name is
 * searched by, and which names are searched at all.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ALIASES, aliasKey, aliasPattern, selectAliases } from '@/lib/discovery/names';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

describe('aliasKey', () => {
  it('is the stored key: the same normaliser every Person row is written with', () => {
    for (const name of ['Abhishek Acharya', 'ABHISHEK ACHARYA', 'José Silva', "O'Brien-Lee"]) {
      expect(aliasKey(name)).toBe(normalizePersonName(name));
    }
  });

  it('collapses runs of whitespace, a non-breaking space and the ends', () => {
    expect(aliasKey('  Abhishek   Acharya ')).toBe('abhishek acharya');
    expect(aliasKey('Abhishek Acharya')).toBe('abhishek acharya');
    expect(aliasKey('Abhishek\t\nAcharya')).toBe('abhishek acharya');
  });
});

/**
 * The rule the query applies: whole-name equality, or (multi-word aliases
 * only) the alias pattern. Postgres `~` reads these patterns the same way
 * (stored keys hold only a-z, 0-9 and single spaces); the real query is
 * checked against Postgres in the PR's local run.
 */
function matches(alias: string, stored: string): boolean {
  const key = aliasKey(alias);
  const pattern = aliasPattern(key);
  return stored === key || (pattern != null && new RegExp(pattern).test(stored));
}

describe('aliasPattern: every alias word, whole and in order', () => {
  it('a two-word alias matches itself, a title before, a word after, a middle name', () => {
    for (const stored of [
      'abhishek acharya',
      'dr abhishek acharya',
      'abhishek acharya iitb',
      'abhishek lalatendu acharya',
    ]) {
      expect(matches('Abhishek Acharya', stored)).toBe(true);
    }
  });

  it('never reordered words, partial words, typos, or a missing word', () => {
    for (const stored of [
      'acharya abhishek',
      'abhishekh acharya',
      'abhishek acharyaa',
      'abhishe acharya',
      'xabhishek acharya',
      'abhishek',
      'acharya',
      'abhishek sharma',
    ]) {
      expect(matches('Abhishek Acharya', stored)).toBe(false);
    }
  });

  it('a three-word alias needs all three words in order', () => {
    expect(matches('Abhishek Lalatendu Acharya', 'abhishek lalatendu acharya')).toBe(true);
    expect(matches('Abhishek Lalatendu Acharya', 'dr abhishek lalatendu acharya')).toBe(true);
    expect(matches('Abhishek Lalatendu Acharya', 'abhishek acharya')).toBe(false);
    expect(matches('Abhishek Lalatendu Acharya', 'lalatendu abhishek acharya')).toBe(false);
  });

  it('a one-word alias is whole-name equality only: no pattern at all', () => {
    expect(aliasPattern('abhishek')).toBeNull();
    expect(matches('Abhishek', 'abhishek')).toBe(true);
    expect(matches('Abhishek', 'abhishek sharma')).toBe(false);
    expect(matches('Abhishek', 'abhishek acharya')).toBe(false);
    expect(matches('Abhishek', 'dr abhishek')).toBe(false);
  });

  it('is whitespace-, case- and accent-insensitive through the normaliser', () => {
    expect(matches('  ABHISHEK   Acharya ', 'dr abhishek acharya')).toBe(true);
    expect(matches('José Silva', 'dr jos silva')).toBe(true);
  });

  it('escapes regex metacharacters, and the normaliser strips them from real names first', () => {
    expect(aliasPattern('a.b c+d')).toBe('(^| )a\\.b( .*)? c\\+d( |$)');
    expect(new RegExp(aliasPattern('a.b c+d') as string).test('axb ccd')).toBe(false);
    expect(aliasKey('Abhi%shek Ach_arya')).toBe('abhishek ach arya');
    expect(aliasKey('Abhishek (Acharya)*')).toBe('abhishek acharya');
  });
});

describe('selectAliases', () => {
  it('one alias per distinct key, keeping the first spelling', () => {
    const s = selectAliases(['Abhishek Acharya', 'ABHISHEK  ACHARYA', 'Abhi Acharya']);
    expect(s.aliases).toEqual([
      { name: 'Abhi Acharya', key: 'abhi acharya' },
      { name: 'Abhishek Acharya', key: 'abhishek acharya' },
    ]);
  });

  it('searches a one-word name too (it can only ever match that one word in full)', () => {
    expect(selectAliases(['Abhishek']).aliases).toEqual([{ name: 'Abhishek', key: 'abhishek' }]);
  });

  it('never searches a stand-in, and counts names in a script the keys cannot hold', () => {
    const s = selectAliases(['Swing 2', 'TBA', '王欣月']);
    expect(s.aliases).toEqual([]);
    expect(s.unsearchable).toBe(1);
  });

  it('stops at MAX_ALIASES and counts the rest', () => {
    const names = Array.from({ length: MAX_ALIASES + 3 }, (_, i) => `Name ${'x'.repeat(i + 1)}`);
    const s = selectAliases(names);
    expect(s.aliases).toHaveLength(MAX_ALIASES);
    expect(s.overLimit).toBe(3);
  });
});
