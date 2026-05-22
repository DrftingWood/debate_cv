import { describe, expect, test } from 'vitest';
import { pickPrelimRoundCount } from '@/lib/calicotab/prelimRoundCount';

describe('pickPrelimRoundCount', () => {
  test('returns stored when positive', () => {
    expect(pickPrelimRoundCount({ stored: 5, maxTeamRoundNumber: 4 })).toBe(5);
    expect(pickPrelimRoundCount({ stored: 8, maxTeamRoundNumber: null })).toBe(8);
    expect(pickPrelimRoundCount({ stored: 8, maxTeamRoundNumber: 0 })).toBe(8);
  });

  test('falls back to maxTeamRoundNumber when stored is null', () => {
    expect(pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: 5 })).toBe(5);
  });

  test('falls back to maxTeamRoundNumber when stored is zero', () => {
    // The current buildCvData.ts:236 guard is `> 0` — zero stored is
    // treated the same as missing.
    expect(pickPrelimRoundCount({ stored: 0, maxTeamRoundNumber: 4 })).toBe(4);
  });

  test('returns null when both are missing or non-positive', () => {
    expect(pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: null })).toBeNull();
    expect(pickPrelimRoundCount({ stored: 0, maxTeamRoundNumber: 0 })).toBeNull();
    expect(pickPrelimRoundCount({ stored: 0, maxTeamRoundNumber: null })).toBeNull();
    expect(pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: 0 })).toBeNull();
  });

  test('negative values are treated as missing', () => {
    // Defensive: schema is Int? so the DB shouldn't produce these,
    // but the helper is pure and shouldn't assume.
    expect(pickPrelimRoundCount({ stored: -1, maxTeamRoundNumber: 5 })).toBe(5);
    expect(pickPrelimRoundCount({ stored: 3, maxTeamRoundNumber: -1 })).toBe(3);
  });
});
