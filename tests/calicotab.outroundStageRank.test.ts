import { describe, expect, test } from 'vitest';
import { __test_outroundStageRank as rank } from '@/lib/calicotab/ingest';

describe('outroundStageRank', () => {
  test('returns null for missing or numeric prelim stages', () => {
    expect(rank(null)).toBeNull();
    expect(rank(undefined)).toBeNull();
    expect(rank('')).toBeNull();
    expect(rank('Round 4')).toBeNull();
  });

  test('canonical stages keep their previous ordering', () => {
    const grand = rank('Grand Final');
    const final = rank('Final');
    const semi = rank('Semifinals');
    const quarter = rank('Quarterfinals');
    const octo = rank('Octofinals');
    const dof = rank('Double Octofinals');
    const tof = rank('Triple Octofinals');
    expect(grand).toBeGreaterThan(final!);
    expect(final).toBeGreaterThan(semi!);
    expect(semi).toBeGreaterThan(quarter!);
    expect(quarter).toBeGreaterThan(octo!);
    expect(octo).toBeGreaterThan(dof!);
    expect(dof).toBeGreaterThan(tof!);
  });

  test('category-prefixed Final ranks the same as plain Final (regression: Novice Final dropped from lastOutroundChaired)', () => {
    // Tabbycat splits a tournament into multiple parallel break categories
    // and labels each bracket's last round with the category name. Before
    // this fix the bare-final regex was anchored at `^…$`, so "Novice Final"
    // returned null and the chair role on it never reached
    // lastOutroundChaired / eliminationReached.
    expect(rank('Novice Final')).toBe(rank('Final'));
    expect(rank('ESL Final')).toBe(rank('Final'));
    expect(rank('EFL Final')).toBe(rank('Final'));
    expect(rank('U16 Final')).toBe(rank('Final'));
    expect(rank('Open Final')).toBe(rank('Final'));
  });

  test('category-prefixed semis/quarters/octos still match the stage-specific rank, not the bare-final fallback', () => {
    // Guards against the substring fallthrough: "Novice Quarterfinal"
    // contains "final" and would otherwise rank 100.
    expect(rank('Novice Quarterfinals')).toBe(rank('Quarterfinals'));
    expect(rank('ESL Semifinals')).toBe(rank('Semifinals'));
    expect(rank('U16 Octofinals')).toBe(rank('Octofinals'));
    expect(rank('Novice Grand Final')).toBe(rank('Grand Final'));
  });

  test('plural and abbreviated forms', () => {
    expect(rank('Finals')).toBe(rank('Final'));
    expect(rank('SF')).toBe(rank('Semifinals'));
    expect(rank('QF')).toBe(rank('Quarterfinals'));
    expect(rank('GF')).toBe(rank('Grand Final'));
    expect(rank('Quarters')).toBe(rank('Quarterfinals'));
    expect(rank('Semis')).toBe(rank('Semifinals'));
  });
});
