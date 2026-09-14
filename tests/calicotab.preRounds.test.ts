import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';
import { outroundRank } from '@/lib/calicotab/judgeStats';
import { formatStageForDisplay } from '@/lib/cv/formatStage';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;
const rankOf = (label: string) =>
  outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });

/**
 * BP runs four to a room and advances two. When the break is not a power of
 * two, the top teams are protected and the rest play in:
 *
 *   break 6   pre-final       6,5,4,3 debate;   1,2   protected to the Final
 *   break 12  pre-semis       5-12 debate;      1-4   protected to Semis
 *   break 24  pre-quarters    9-24 debate;      1-8   protected to Quarters
 *   break 48  pre-octos       17-48 debate;     1-16  protected to Octos
 *
 * So a pre-round is a real round in its own right. It is NOT the round it
 * feeds — a team in the pre-final has not reached the final — and it is not
 * the round below either: a 6-break pre-final has no semifinal to be.
 */
describe('pre-rounds are their own stages', () => {
  test('each pre-round classifies as itself', () => {
    expect(stageOf('Pre-Finals')).toBe('pre_final');
    expect(stageOf('Pre-Semifinals')).toBe('pre_semifinal');
    expect(stageOf('Pre-Quarterfinals')).toBe('pre_quarterfinal');
    expect(stageOf('Pre-Octofinals')).toBe('pre_octofinal');
  });

  test('never the round it feeds', () => {
    expect(stageOf('Pre-Finals')).not.toBe('final');
    expect(stageOf('Pre-Semifinals')).not.toBe('semifinal');
    expect(stageOf('Pre-Quarterfinals')).not.toBe('quarterfinal');
    expect(stageOf('Pre-Grand Finals')).not.toBe('grand_final');
  });

  test('a pre-grand-final is the pre-final', () => {
    // Same round under a longer name: the play-in that feeds the final.
    expect(stageOf('Pre-Grand Finals')).toBe('pre_final');
    expect(stageOf('Pre Grand Final')).toBe('pre_final');
  });

  test('the spellings seen in the wild all land', () => {
    expect(stageOf('Pré-Semifinal')).toBe('pre_semifinal');
    expect(stageOf('PréSemifinais')).toBe('pre_semifinal');
    expect(stageOf('Pre Semi Finals')).toBe('pre_semifinal');
    expect(stageOf('Pre - Finals')).toBe('pre_final');
    expect(stageOf('Senior Pre Semi')).toBe('pre_semifinal');
    expect(stageOf('High School Pre Quarter')).toBe('pre_quarterfinal');
    expect(stageOf('Prefinals')).toBe('pre_final');
  });

  test('ranked between the round it feeds and the round below it', () => {
    // A team knocked out in the pre-final placed 3rd-6th: further than a
    // semifinalist of an 8-break, not as far as a finalist.
    expect(rankOf('Pre-Finals')).toBeGreaterThan(rankOf('Semifinals'));
    expect(rankOf('Pre-Finals')).toBeLessThan(rankOf('Final'));

    expect(rankOf('Pre-Semifinals')).toBeGreaterThan(rankOf('Quarterfinals'));
    expect(rankOf('Pre-Semifinals')).toBeLessThan(rankOf('Semifinals'));

    expect(rankOf('Pre-Quarterfinals')).toBeGreaterThan(rankOf('Octofinals'));
    expect(rankOf('Pre-Quarterfinals')).toBeLessThan(rankOf('Quarterfinals'));

    expect(rankOf('Pre-Octofinals')).toBeGreaterThan(rankOf('Double Octofinals'));
    expect(rankOf('Pre-Octofinals')).toBeLessThan(rankOf('Octofinals'));
  });

  test('displayed as the round it is', () => {
    expect(formatStageForDisplay('Pre-Finals')).toBe('Pre-Final');
    expect(formatStageForDisplay('Pre-Semifinals')).toBe('Pre-Semifinals');
    expect(formatStageForDisplay('Pré-Semifinal')).toBe('Pre-Semifinals');
    expect(formatStageForDisplay('Pre-Quarterfinals')).toBe('Pre-Quarterfinals');
  });

  test('the break category still comes through', () => {
    expect(splitStageLabel('Open Pre-Quarterfinals')).toEqual({
      category: 'Open',
      stage: 'pre_quarterfinal',
    });
    expect(splitStageLabel('High School Pre-Grand Finals')).toEqual({
      category: 'High School',
      stage: 'pre_final',
    });
    expect(splitStageLabel('Iniciado Pré-Final')).toEqual({
      category: 'Iniciado',
      stage: 'pre_final',
    });
    expect(formatStageForDisplay('Novice Pre-Semifinals')).toBe('Novice Pre-Semifinals');
  });

  test('an ordinary round is untouched', () => {
    expect(stageOf('Semifinals')).toBe('semifinal');
    expect(stageOf('Grand Final')).toBe('grand_final');
    expect(stageOf('Quarterfinals')).toBe('quarterfinal');
    expect(formatStageForDisplay('High School Grand Final')).toBe('High School Final');
  });
});
