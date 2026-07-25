import { describe, expect, test } from 'vitest';
import { deepestOutroundAcrossRoles } from '@/lib/calicotab/judgeStats';

// outroundRank is covered in calicotab.outroundRank.test.ts, and the judge
// aggregation that actually ships lives in lib/calicotab/judgeAggregates.ts
// (covered by calicotab.judgeAggregates.test.ts). What remains here is the
// chair-vs-panel tiebreak.

describe('deepestOutroundAcrossRoles', () => {
  test('returns null when neither role recorded an outround', () => {
    expect(deepestOutroundAcrossRoles(null, null)).toBeNull();
    expect(deepestOutroundAcrossRoles(undefined, undefined)).toBeNull();
  });

  test('returns the only present value when one side is null', () => {
    expect(deepestOutroundAcrossRoles('Semifinals', null)).toBe('Semifinals');
    expect(deepestOutroundAcrossRoles(null, 'Quarterfinals')).toBe('Quarterfinals');
  });

  test('picks the deeper round when both are populated', () => {
    expect(deepestOutroundAcrossRoles('Quarterfinals', 'Semifinals')).toBe('Semifinals');
    expect(deepestOutroundAcrossRoles('Grand Final', 'Semifinals')).toBe('Grand Final');
  });

  test('chaired wins ties — chair is the stronger credential at equal depth', () => {
    expect(deepestOutroundAcrossRoles('Semifinals', 'Semifinals')).toBe('Semifinals');
  });
});
