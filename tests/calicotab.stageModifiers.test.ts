import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;
const catOf = (s: string) => splitStageLabel(s).category;

describe('"pre-" rounds are their own thing', () => {
  // A pre-semifinal is a play-in: with 12 teams breaking, 8 debate while 4
  // bye. It has neither the field size nor the standing of a quarterfinal,
  // so calling it one overstates the round — and calling it a semifinal,
  // which is what the bare stage rules did, overstates it further. There is
  // no honest mapping onto the canonical ladder, so it gets none: the label
  // is shown as written and simply does not rank.
  test('a pre-round does not classify as the round it names', () => {
    expect(stageOf('Pre-Quarterfinals')).toBe(null);
    expect(stageOf('Pre-Semifinals')).toBe(null);
    expect(stageOf('Pre-Octofinals')).toBe(null);
    expect(stageOf('Prefinals')).toBe(null);
    expect(stageOf('Pre-Grand Finals')).toBe(null);
  });

  test('nor as the round before it', () => {
    for (const label of ['Pre-Quarterfinals', 'Pre-Semifinals', 'Pre-Grand Finals']) {
      expect(stageOf(label), label).toBe(null);
    }
  });

  test('the accented and spaced spellings behave the same', () => {
    expect(stageOf('Pré-Semifinal')).toBe(null);
    expect(stageOf('PréSemifinais')).toBe(null);
    expect(stageOf('Iniciado Pré-Final')).toBe(null);
    expect(stageOf('Pre Semi Finals')).toBe(null);
    expect(stageOf('High School Pre Quarter')).toBe(null);
    expect(stageOf('Senior Pre Semi')).toBe(null);
  });

  test('an ordinary round of the same name is unaffected', () => {
    expect(stageOf('Quarterfinals')).toBe('quarterfinal');
    expect(stageOf('Semifinals')).toBe('semifinal');
    expect(stageOf('Grand Final')).toBe('grand_final');
    expect(stageOf('High School Grand Final')).toBe('grand_final');
    expect(catOf('Gold Final')).toBe('Gold');
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

describe('"pre-" forms found only by querying the corpus', () => {
  // Each of these was landing on a real stage and breaking the round-order
  // invariant (within one tournament and break category, a later round
  // cannot be a shallower stage). None of them is that stage.
  test('accented and grand forms do not classify either', () => {
    expect(matchStage('Pré-Semifinal')).toBe(null);
    expect(matchStage('PréSemifinais')).toBe(null);
    expect(matchStage('Pré-Final')).toBe(null);
    expect(matchStage('Pre-Grand Finals')).toBe(null);
    expect(matchStage('Pre Grand Final')).toBe(null);
  });

  test('a real grand final is still read', () => {
    expect(matchStage('Grand Final')?.stage).toBe('grand_final');
    expect(matchStage('High School Grand Final')?.stage).toBe('grand_final');
  });
});
