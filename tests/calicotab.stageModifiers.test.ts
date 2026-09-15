import { describe, expect, test } from 'vitest';
import { isPreRound, matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';
import { outroundRankStrict } from '@/lib/calicotab/judgeStats';
import { formatStageForDisplay } from '@/lib/cv/formatStage';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;
const catOf = (s: string) => splitStageLabel(s).category;
const rankOf = (s: string) => outroundRankStrict(s)!;

describe('"partial" is the play-in before the stage it names', () => {
  // A partial quarterfinal runs before the quarterfinal, for the places the
  // top seeds are not already holding there. It is the pre-quarterfinal.
  test('each partial round is the pre-round of its stage', () => {
    expect(stageOf('Partial Quarterfinals')).toBe('pre_quarterfinal');
    expect(stageOf('Partial Quarter-Finals')).toBe('pre_quarterfinal');
    expect(stageOf('ESL Partial Quarters')).toBe('pre_quarterfinal');
    expect(stageOf('Partial Octofinals')).toBe('pre_octofinal');
    expect(stageOf("Partial Semi's")).toBe('pre_semifinal');
    expect(stageOf('Partial finals')).toBe('pre_final');
    expect(stageOf('Octavos Parcial')).toBe('pre_octofinal');
  });

  test('it ranks below the stage it feeds and above the one before', () => {
    expect(rankOf('Partial Quarterfinals')).toBeLessThan(rankOf('Quarterfinals'));
    expect(rankOf('Partial Quarterfinals')).toBeGreaterThan(rankOf('Octofinals'));
  });

  test('two rounds of one tournament no longer share a rung', () => {
    // 01-rean, lucien, paudc2022: "Partial Quarterfinals", then "Quarterfinals".
    expect(stageOf('Partial Quarterfinals')).not.toBe(stageOf('Quarterfinals'));
  });

  test('it counts as a play-in', () => {
    expect(isPreRound('Partial Octofinals')).toBe(true);
    expect(isPreRound('Partial Double Octofinals')).toBe(true);
    expect(isPreRound('Octofinals')).toBe(false);
  });

  test('it is not reported as a break category', () => {
    expect(catOf('Partial Octofinals')).toBe(null);
    expect(catOf('Partial Quarterfinals')).toBe(null);
    expect(catOf('Partial Double Quarterfinals')).toBe(null);
    expect(catOf("Partial Semi's")).toBe(null);
    expect(splitStageLabel('Novice Partial Semis')).toEqual({ category: 'Novice', stage: 'pre_semifinal' });
  });
});

describe('a partial double round keeps its name', () => {
  // WUDC's "Partial Double-Octofinals", EUDC's "Partial Double Quarters":
  // named as partial rounds everywhere they run, so never shown as "Pre-".
  test('each has a partial-double stage of its own', () => {
    expect(stageOf('Partial Double-Octofinals')).toBe('partial_double_octofinal');
    expect(stageOf('Open Partial Double Octas')).toBe('partial_double_octofinal');
    expect(stageOf('Partial Double Quarters')).toBe('partial_double_quarterfinal');
    expect(stageOf('Partial-double Quarterfinals')).toBe('partial_double_quarterfinal');
    expect(stageOf('Partial Double Semifinals')).toBe('partial_double_semifinal');
    expect(stageOf('Partial Triple Octofinals')).toBe('partial_triple_octofinal');
  });

  test('it displays as a partial round, never "Pre-"', () => {
    expect(formatStageForDisplay('Partial Double-Octofinals')).toBe('Partial Double Octofinals');
    expect(formatStageForDisplay('Partial Double Quarters')).toBe('Partial Double Quarterfinals');
    expect(formatStageForDisplay('ESL Partial Double Quarters')).toBe('ESL Partial Double Quarterfinals');
    expect(formatStageForDisplay('Partial Double Semifinals')).toBe('Partial Double Semifinals');
    for (const l of ['Partial Double-Octofinals', 'Partial Double Quarters', 'Partial Double Semifinals']) {
      expect(formatStageForDisplay(l)).not.toMatch(/^Pre|\bPre-/);
    }
  });

  test('it ranks as the play-in it is', () => {
    // A double quarterfinal is the octofinal; its partial round ranks with
    // the pre-octofinal, between the double-octofinal and the octofinal.
    expect(rankOf('Partial Double Quarters')).toBe(rankOf('Pre-Octofinals'));
    expect(rankOf('Partial Double Semifinals')).toBe(rankOf('Pre-Quarterfinals'));
    expect(rankOf('Partial Double Octofinals')).toBeLessThan(rankOf('Double Octofinals'));
    expect(rankOf('Partial Double Octofinals')).toBeGreaterThan(rankOf('Triple Octofinals'));
    expect(rankOf('Partial Double Octofinals')).toBeLessThan(rankOf('Octofinals'));
  });

  test('the category is still read', () => {
    expect(splitStageLabel('ESL Partial Double Quarters')).toEqual({
      category: 'ESL',
      stage: 'partial_double_quarterfinal',
    });
  });
});

describe('"double" names a real stage, not a modifier, before quarters and semis', () => {
  // A double quarterfinal has twice the rooms of the quarters: it is the
  // octofinal. Read as a modifier, "double" was dropped and the label
  // classified one full stage deeper than the round was.
  test('a double quarterfinal is an octofinal', () => {
    expect(stageOf('Double Quarterfinals')).toBe('octofinal');
    expect(stageOf('Double Quarters')).toBe('octofinal');
    expect(stageOf('Double Quarter-Finals')).toBe('octofinal');
  });

  test('a double semifinal is a quarterfinal', () => {
    expect(stageOf('Double Semis')).toBe('quarterfinal');
    expect(stageOf('Double Semifinals')).toBe('quarterfinal');
    expect(stageOf('Semifinals')).toBe('semifinal');
  });
});

describe('ordinary stages are untouched by the modifier handling', () => {
  test('plain rounds keep their stage and have no category', () => {
    expect(stageOf('Quarterfinals')).toBe('quarterfinal');
    expect(stageOf('Semifinals')).toBe('semifinal');
    expect(stageOf('Octofinals')).toBe('octofinal');
    expect(catOf('Quarterfinals')).toBe(null);
  });

  test('a real category is still read', () => {
    expect(catOf('Gold Final')).toBe('Gold');
    expect(catOf('ESL Grand Final')).toBe('ESL');
  });
});
