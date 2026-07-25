import { describe, expect, test } from 'vitest';
import { outroundRank, outroundRankStrict } from '@/lib/calicotab/judgeStats';

/**
 * The single home for outround stage ranking.
 *
 * Consolidates what used to be three files — calicotab.outroundStageRank,
 * calicotab.outroundRank.unification, and the `outroundRank` block inside
 * judgeStats.test — which between them asserted the null cases three times,
 * the stage ordering twice, and the category-prefix rule twice.
 *
 * Both exports are here because they are the same ladder behind two
 * signatures: `outroundRankStrict(label)` returns a rank or null, and
 * `outroundRank({label, roundNumber, isOutround})` adds the prelim guard and
 * the numeric fallback. The scale (50–100) is load-bearing for the champion
 * check in buildCvData and for pickDeepestOutround in speakerStats.
 */

describe('outroundRankStrict', () => {
  test('returns null for anything that is not an outround stage', () => {
    expect(outroundRankStrict(null)).toBeNull();
    expect(outroundRankStrict(undefined)).toBeNull();
    expect(outroundRankStrict('')).toBeNull();
    expect(outroundRankStrict('Round 4')).toBeNull();
    expect(outroundRankStrict('1')).toBeNull();
  });

  test('canonical stages carry their exact rank, deepest first', () => {
    // Absolute values, not just ordering: the champion check compares
    // against outroundRank('Final'), so the gap between Final and Semifinal
    // is what makes "reached the GF" distinguishable from "reached semis".
    expect(outroundRankStrict('Grand Final')).toBe(100);
    expect(outroundRankStrict('Final')).toBe(95);
    expect(outroundRankStrict('Semifinal')).toBe(90);
    expect(outroundRankStrict('Quarterfinal')).toBe(80);
    expect(outroundRankStrict('Octofinal')).toBe(70);
    expect(outroundRankStrict('Double Octofinals')).toBe(60);
    expect(outroundRankStrict('Triple Octofinals')).toBe(50);
  });

  test('a category prefix does not change the stage', () => {
    // Tabbycat labels each parallel break category's rounds with the
    // category name. A bare-final regex anchored at ^…$ made "Novice Final"
    // return null, and the chair role on it never reached
    // lastOutroundChaired / eliminationReached.
    expect(outroundRankStrict('Novice Final')).toBe(95);
    expect(outroundRankStrict('ESL Final')).toBe(95);
    expect(outroundRankStrict('EFL Final')).toBe(95);
    expect(outroundRankStrict('U16 Final')).toBe(95);
    expect(outroundRankStrict('Open Final')).toBe(95);
    expect(outroundRankStrict('Open Grand Final')).toBe(100);
    // …and the stage-specific patterns still beat the bare-final
    // fallthrough, which every one of these would otherwise hit on the
    // substring "final".
    expect(outroundRankStrict('Novice Quarterfinals')).toBe(80);
    expect(outroundRankStrict('ESL Semifinals')).toBe(90);
    expect(outroundRankStrict('U16 Octofinals')).toBe(70);
  });

  test('plural and abbreviated forms resolve to the same stage', () => {
    expect(outroundRankStrict('Finals')).toBe(outroundRankStrict('Final'));
    expect(outroundRankStrict('GF')).toBe(outroundRankStrict('Grand Final'));
    expect(outroundRankStrict('SF')).toBe(outroundRankStrict('Semifinals'));
    expect(outroundRankStrict('QF')).toBe(outroundRankStrict('Quarterfinals'));
    expect(outroundRankStrict('Semis')).toBe(outroundRankStrict('Semifinals'));
    expect(outroundRankStrict('Quarters')).toBe(outroundRankStrict('Quarterfinals'));
  });
});

describe('outroundRank', () => {
  test('prelims rank -1, and numeric outrounds fall back to the round number', () => {
    expect(outroundRank({ roundLabel: 'Round 4', roundNumber: 4, isOutround: false })).toBe(-1);
    const r9 = outroundRank({ roundLabel: 'Round 9', roundNumber: 9, isOutround: true });
    const r8 = outroundRank({ roundLabel: 'Round 8', roundNumber: 8, isOutround: true });
    expect(r9).toBeGreaterThan(r8);
  });

  test('agrees with the strict variant for any classifiable label', () => {
    for (const label of ['Grand Final', 'Final', 'Semifinal', 'Quarterfinal', 'Octofinal']) {
      expect(outroundRank({ roundLabel: label, roundNumber: null, isOutround: true })).toBe(
        outroundRankStrict(label),
      );
    }
  });

  test('champion threshold: only a Final or deeper clears outroundRank("Final")', () => {
    // The comparison buildCvData makes to decide `wonTournament`, and the
    // reason pickDeepestOutround must not use substring matching.
    const rank = (label: string) =>
      outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });
    const threshold = rank('Final');
    expect(rank('Grand Final')).toBeGreaterThanOrEqual(threshold);
    expect(rank('Final')).toBeGreaterThanOrEqual(threshold);
    expect(rank('ESL Final')).toBeGreaterThanOrEqual(threshold);
    expect(rank('Semifinal')).toBeLessThan(threshold);
    expect(rank('Quarterfinal')).toBeLessThan(threshold);
  });
});
