import { describe, expect, test } from 'vitest';
import { isStraights, outcomeKind, roundFirst, roundHit, OUTCOME_COPY } from '@/lib/cv/roundOutcome';

const BP = 'British Parliamentary';
const AP = 'Asian Parliamentary';

describe('roundHit: BP is never a "win"', () => {
  test('two-team formats keep the recorded win', () => {
    expect(roundHit(AP, { points: null, won: true })).toBe(true);
    expect(roundHit(AP, { points: null, won: false })).toBe(false);
    expect(roundHit(AP, { points: null, won: null })).toBeNull();
  });

  test('BP: 1st and 2nd are hits, 3rd and 4th are not', () => {
    expect(roundHit(BP, { points: 3, won: true })).toBe(true);
    expect(roundHit(BP, { points: 2, won: false })).toBe(true); // 2nd: stored won=false, still a hit
    expect(roundHit(BP, { points: 1, won: false })).toBe(false);
    expect(roundHit(BP, { points: 0, won: false })).toBe(false);
  });

  test('BP without points: a recorded 1st still counts, a non-1st cannot be placed', () => {
    expect(roundHit(BP, { points: null, won: true })).toBe(true);
    expect(roundHit(BP, { points: null, won: false })).toBeNull();
  });

  test('a four-seat position is BP whatever the format says', () => {
    expect(roundHit(null, { position: 'OG', points: 2, won: false })).toBe(true);
  });
});

describe('roundFirst', () => {
  test('only 3 points is a first', () => {
    expect(roundFirst({ points: 3, won: true })).toBe(true);
    expect(roundFirst({ points: 2, won: false })).toBe(false);
    expect(roundFirst({ points: null, won: true })).toBe(true);
  });
});

describe('isStraights: points >= 2 x rounds', () => {
  test('averaging exactly second is straights', () => {
    expect(isStraights(10, 5)).toBe(true);
    expect(isStraights(9, 5)).toBe(false);
    expect(isStraights(15, 5)).toBe(true);
  });

  test('3,0,3,0 is two firsts but NOT straights: judged on the total', () => {
    expect(isStraights(6, 4)).toBe(false);
  });

  test('no total or no rounds is unknown, not false', () => {
    expect(isStraights(null, 5)).toBeNull();
    expect(isStraights(10, 0)).toBeNull();
    expect(isStraights(10, null)).toBeNull();
  });
});

describe('outcomeKind and copy', () => {
  test('picks the wording from the formats present', () => {
    expect(outcomeKind([AP, 'World Schools'])).toBe('win');
    expect(outcomeKind([BP, BP])).toBe('top-two');
    expect(outcomeKind([BP, AP])).toBe('mixed');
  });

  test('BP copy never says win or won', () => {
    const c = OUTCOME_COPY['top-two'];
    expect(JSON.stringify(c).toLowerCase()).not.toMatch(/\bwin|\bwon\b/);
  });
});
