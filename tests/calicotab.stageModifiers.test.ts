import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;
const catOf = (s: string) => splitStageLabel(s).category;

describe('"pre-" names the round BEFORE the stage it mentions', () => {
  // Found by querying the corpus database: "Pre-Quarterfinals" was
  // classifying as `quarterfinal` because the quarter rule matched the word
  // inside it. That is the overstatement this whole lexicon exists to stop —
  // a team knocked out in pre-quarters had not reached the quarterfinals.
  test('pre-quarterfinals is the octofinal round', () => {
    expect(stageOf('Pre-Quarterfinals')).toBe('octofinal');
    expect(stageOf('Pre Quarterfinals')).toBe('octofinal');
    expect(stageOf('Pre-quarterfinals')).toBe('octofinal');
    expect(stageOf('High School Pre Quarter')).toBe('octofinal');
  });

  test('pre-semifinals is the quarterfinal round', () => {
    expect(stageOf('Pre-Semifinals')).toBe('quarterfinal');
    expect(stageOf('Pre Semi Finals')).toBe('quarterfinal');
    expect(stageOf('Pre-Semi Final')).toBe('quarterfinal');
    expect(stageOf('Senior Pre Semi')).toBe('quarterfinal');
  });

  test('pre-octofinals is the double-octofinal round', () => {
    expect(stageOf('Pre-Octofinals')).toBe('double_octofinal');
  });

  test('prefinals is the semifinal round', () => {
    expect(stageOf('Prefinals')).toBe('semifinal');
    expect(stageOf('Pre-Finals')).toBe('semifinal');
  });

  test('"pre" is never a break category', () => {
    expect(catOf('Pre-Quarterfinals')).toBe(null);
    expect(catOf('Pre-Semifinals')).toBe(null);
    // …and a real category alongside it still survives.
    expect(catOf('Open Pre-Quarterfinals')).toBe('Open');
    expect(catOf('Novice Pre-Quarterfinals')).toBe('Novice');
    expect(catOf('High School Pre Quarter')).toBe('High School');
  });
});

describe('"partial" is a modifier, not a category', () => {
  // A partial octofinal IS an octofinal — some teams bye straight through.
  test('the stage is unchanged', () => {
    expect(stageOf('Partial Octofinals')).toBe('octofinal');
    expect(stageOf('Partial Quarterfinals')).toBe('quarterfinal');
    expect(stageOf('Partial Double Octofinals')).toBe('double_octofinal');
  });

  test('it is not reported as a break category', () => {
    expect(catOf('Partial Octofinals')).toBe(null);
    expect(catOf('Partial Quarterfinals')).toBe(null);
    expect(catOf('Partial Double Quarterfinals')).toBe(null);
    expect(catOf("Partial Semi's")).toBe(null);
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
