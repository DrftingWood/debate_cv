import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';
import { outroundRank } from '@/lib/calicotab/judgeStats';
import { formatStageForDisplay } from '@/lib/cv/formatStage';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;
const rankOf = (label: string) =>
  outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });

/**
 * Pre and Partial name one round from opposite sides. BP, four to a room,
 * two advance:
 *
 *   break 6    Final holds 4   → teams 3-6 debate, 1-2 wait
 *              that room is a Pre-Final, and it is a Partial Semifinal
 *   break 12   Semis hold 8    → 5-12 debate: Pre-Semis = Partial Quarterfinals
 *   break 24   Quarters hold 16 → 9-24 debate: Pre-Quarters = Partial Octofinals
 *   break 48   Octos hold 32   → 17-48 debate: Pre-Octos = Partial Double Octofinals
 *
 * Every such label resolves to its Partial rung, shown under one name.
 */
describe('a pre-round is the partial round of the rung below', () => {
  test('each pre-round lands on its partial rung', () => {
    expect(stageOf('Pre-Finals')).toBe('partial_semifinal');
    expect(stageOf('Pre-Semifinals')).toBe('partial_quarterfinal');
    expect(stageOf('Pre-Quarterfinals')).toBe('partial_octofinal');
    expect(stageOf('Pre-Octofinals')).toBe('partial_double_octofinal');
    expect(stageOf('Pre-Double-Octofinals')).toBe('partial_triple_octofinal');
  });

  test('and meets the partial label for the same round', () => {
    expect(stageOf('Pre-Finals')).toBe(stageOf('Partial Semifinals'));
    expect(stageOf('Pre-Semifinals')).toBe(stageOf('Partial Quarterfinals'));
    expect(stageOf('Pre-Quarterfinals')).toBe(stageOf('Partial Octofinals'));
    expect(stageOf('Pre-Octofinals')).toBe(stageOf('Partial Double Octofinals'));
  });

  test('a pre-grand-final is the pre-final', () => {
    expect(stageOf('Pre-Grand Finals')).toBe('partial_semifinal');
    expect(stageOf('Pre Grand Final')).toBe('partial_semifinal');
  });

  test('the spellings seen in the wild all land', () => {
    expect(stageOf('Pré-Semifinal')).toBe('partial_quarterfinal');
    expect(stageOf('PréSemifinais')).toBe('partial_quarterfinal');
    expect(stageOf('Pre Semi Finals')).toBe('partial_quarterfinal');
    expect(stageOf('Pre - Finals')).toBe('partial_semifinal');
    expect(stageOf('Senior Pre Semi')).toBe('partial_quarterfinal');
    expect(stageOf('High School Pre Quarter')).toBe('partial_octofinal');
    expect(stageOf('Prefinals')).toBe('partial_semifinal');
    expect(stageOf('Pre-Octos')).toBe('partial_double_octofinal');
  });

  test('ranked just below the full rung and above the rung beneath', () => {
    expect(rankOf('Pre-Finals')).toBeLessThan(rankOf('Semifinals'));
    expect(rankOf('Pre-Finals')).toBeGreaterThan(rankOf('Quarterfinals'));
    expect(rankOf('Pre-Semifinals')).toBeLessThan(rankOf('Quarterfinals'));
    expect(rankOf('Pre-Semifinals')).toBeGreaterThan(rankOf('Octofinals'));
    expect(rankOf('Pre-Quarterfinals')).toBeLessThan(rankOf('Octofinals'));
    expect(rankOf('Pre-Quarterfinals')).toBeGreaterThan(rankOf('Double Octofinals'));
    expect(rankOf('Pre-Octofinals')).toBeLessThan(rankOf('Double Octofinals'));
    expect(rankOf('Pre-Octofinals')).toBeGreaterThan(rankOf('Triple Octofinals'));
  });

  test('displayed under the one partial name', () => {
    expect(formatStageForDisplay('Pre-Finals')).toBe('Partial Semifinals');
    expect(formatStageForDisplay('Pre-Semifinals')).toBe('Partial Quarterfinals');
    expect(formatStageForDisplay('Pré-Semifinal')).toBe('Partial Quarterfinals');
    expect(formatStageForDisplay('Pre-Quarterfinals')).toBe('Partial Octofinals');
    expect(formatStageForDisplay('Pre-Octofinals')).toBe('Partial Double Octofinals');
  });

  test('the break category still comes through', () => {
    expect(splitStageLabel('Open Pre-Quarterfinals')).toEqual({ category: 'Open', stage: 'partial_octofinal' });
    expect(splitStageLabel('High School Pre-Grand Finals')).toEqual({
      category: 'High School',
      stage: 'partial_semifinal',
    });
    expect(splitStageLabel('Iniciado Pré-Final')).toEqual({ category: 'Iniciado', stage: 'partial_semifinal' });
    expect(formatStageForDisplay('Novice Pre-Semifinals')).toBe('Novice Partial Quarterfinals');
  });

  test('an ordinary round is untouched', () => {
    expect(stageOf('Semifinals')).toBe('semifinal');
    expect(stageOf('Grand Final')).toBe('grand_final');
    expect(stageOf('Quarterfinals')).toBe('quarterfinal');
    expect(stageOf('Pre-Uni Finals')).toBe('final');
    expect(formatStageForDisplay('High School Grand Final')).toBe('High School Final');
  });
});
