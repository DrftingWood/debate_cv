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
  test('falls back to the speaker tab when neither of the first two is set', () => {
    // The case that motivated the third source: a tournament that published
    // per-round speaker columns but no nav round list and no per-round team
    // rows. Without it the field summary loses its divisor and every
    // score-unit figure blanks out while the placement still renders.
    expect(
      pickPrelimRoundCount({
        stored: null,
        maxTeamRoundNumber: null,
        maxSpeakerRoundNumber: 6,
      }),
    ).toBe(6);
  });

  test('the speaker tab never overrides a more authoritative source', () => {
    // A speaker who swung or missed a round must not drag the divisor down.
    expect(
      pickPrelimRoundCount({ stored: 9, maxTeamRoundNumber: null, maxSpeakerRoundNumber: 6 }),
    ).toBe(9);
    expect(
      pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: 8, maxSpeakerRoundNumber: 6 }),
    ).toBe(8);
  });

  test('all three missing is still null', () => {
    expect(
      pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: null, maxSpeakerRoundNumber: null }),
    ).toBeNull();
    expect(
      pickPrelimRoundCount({ stored: 0, maxTeamRoundNumber: 0, maxSpeakerRoundNumber: 0 }),
    ).toBeNull();
  });
});
