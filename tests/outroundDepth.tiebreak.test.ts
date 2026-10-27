import { describe, expect, test } from 'vitest';
import { deepestOutroundAcrossRoles } from '@/lib/calicotab/judgeStats';
import { computeJudgeAggregates } from '@/lib/calicotab/judgeAggregates';
import { deepestOutroundLabel } from '@/lib/cv/speakerSignals';

// "Final" and "Grand Final" share rank 95 and a category final sits at the
// same depth; the Open bracket must win regardless of argument/list order.

describe('deepest outround is independent of order', () => {
  test('deepestOutroundAcrossRoles: Grand Final beats ESL Final both ways', () => {
    expect(deepestOutroundAcrossRoles('ESL Final', 'Grand Final')).toBe('Grand Final');
    expect(deepestOutroundAcrossRoles('Grand Final', 'ESL Final')).toBe('Grand Final');
  });

  test('deepestOutroundLabel agrees for every ordering', () => {
    const labels = ['ESL Final', 'Grand Final', 'Novice Quarterfinals'];
    for (const perm of [labels, [...labels].reverse(), [labels[1], labels[0], labels[2]]]) {
      expect(deepestOutroundLabel(perm)).toBe('Grand Final');
    }
  });

  test('judge aggregates agree for every ordering', () => {
    const a = { stage: 'ESL Final', role: 'chair', roundNumber: null };
    const b = { stage: 'Grand Final', role: 'chair', roundNumber: null };
    expect(computeJudgeAggregates([a, b] as never).deepestChaired).toBe('Grand Final');
    expect(computeJudgeAggregates([b, a] as never).deepestChaired).toBe('Grand Final');
  });

  test('tiered finals: Gold > Silver > Bronze either way', () => {
    expect(deepestOutroundAcrossRoles('Silver Final', 'Gold Final')).toBe('Gold Final');
    expect(deepestOutroundAcrossRoles('Gold Final', 'Silver Final')).toBe('Gold Final');
    expect(deepestOutroundLabel(['Bronze Final', 'Silver Final'])).toBe('Silver Final');
  });

  test('a deeper category stage still beats a shallower Open one', () => {
    expect(deepestOutroundAcrossRoles('Open Quarterfinals', 'ESL Semifinals')).toBe(
      'ESL Semifinals',
    );
  });
});
