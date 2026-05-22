import { describe, it, expect } from 'vitest';
import { personNameMatches } from '@/lib/calicotab/personMatch';

describe('personNameMatches', () => {
  it('returns true for exact normalized match', () => {
    expect(personNameMatches('Abhishek Acharya', 'abhishek acharya')).toBe(true);
    expect(personNameMatches('  ABHISHEK   ACHARYA  ', 'Abhishek Acharya')).toBe(true);
  });

  it('returns true for substring containment in either direction', () => {
    // Middle name dropped on one side: "Abhishek K Acharya" vs "Abhishek Acharya"
    expect(personNameMatches('Abhishek K Acharya', 'Abhishek Acharya')).toBe(true);
    expect(personNameMatches('Abhishek Acharya', 'Abhishek K Acharya')).toBe(true);
  });

  it('returns true when speaker tab adds a parenthetical', () => {
    expect(personNameMatches('Abhishek Acharya (IIT-B)', 'Abhishek Acharya')).toBe(true);
  });

  it('returns true for surname-first comma reorder via token-subset', () => {
    expect(personNameMatches('Acharya, Abhishek', 'Abhishek Acharya')).toBe(true);
  });

  it('returns false on empty either side', () => {
    expect(personNameMatches('', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Abhishek Acharya', '')).toBe(false);
    expect(personNameMatches('', '')).toBe(false);
    expect(personNameMatches('   ', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Abhishek Acharya', '   ')).toBe(false);
  });

  it('refuses single-token fuzzy match against multi-token side', () => {
    // "Abhishek" alone is too ambiguous to fuzzy-match "Abhishek Acharya".
    expect(personNameMatches('Abhishek', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Abhishek Acharya', 'Abhishek')).toBe(false);
  });

  it('exact-matches single-token names on both sides', () => {
    expect(personNameMatches('Plato', 'plato')).toBe(true);
    expect(personNameMatches('plato', 'PLATO')).toBe(true);
  });

  it('refuses to collapse two multi-token people sharing one token', () => {
    expect(personNameMatches('Shaurya Acharya', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Shaurya Acharya', 'Shaurya Chandravanshi')).toBe(false);
  });

  it('is symmetric', () => {
    expect(personNameMatches('A B', 'B A')).toBe(personNameMatches('B A', 'A B'));
    expect(personNameMatches('Abhishek K Acharya', 'Abhishek Acharya'))
      .toBe(personNameMatches('Abhishek Acharya', 'Abhishek K Acharya'));
  });
});
