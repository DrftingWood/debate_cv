import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;

describe('matchStage — stock English vocabulary', () => {
  test('classifies the Tabbycat defaults', () => {
    expect(stageOf('Grand Final')).toBe('grand_final');
    expect(stageOf('Final')).toBe('final');
    expect(stageOf('Semifinals')).toBe('semifinal');
    expect(stageOf('Quarterfinals')).toBe('quarterfinal');
    expect(stageOf('Octofinals')).toBe('octofinal');
    expect(stageOf('Double Octofinals')).toBe('double_octofinal');
    expect(stageOf('Triple Octofinals')).toBe('triple_octofinal');
    expect(stageOf('Partial Double Octofinals')).toBe('double_octofinal');
    expect(stageOf('Round of 16')).toBe('octofinal');
    expect(stageOf('Round of 32')).toBe('double_octofinal');
  });

  test('prelims and unknown labels do not classify', () => {
    expect(stageOf('Round 1')).toBe(null);
    expect(stageOf('Round 9')).toBe(null);
    expect(stageOf('')).toBe(null);
    expect(stageOf('Something Weird')).toBe(null);
  });

  test('tolerates the "Quaterfinals" misspelling seen in the wild', () => {
    expect(stageOf('Open QuaterFinals')).toBe('quarterfinal');
  });
});

describe('matchStage — variant vocabularies', () => {
  // The failure these exist to stop is not a missing label but a WRONG one:
  // a generic \bfinal\b fallback matches the word "Final" inside the Spanish
  // for quarterfinals, reporting a quarterfinalist as having reached the
  // tournament final.
  test('Spanish rounds classify to their real stage', () => {
    expect(stageOf('Cuartos de Final')).toBe('quarterfinal');
    expect(stageOf('Cuartos')).toBe('quarterfinal');
    expect(stageOf('Octavos de Final')).toBe('octofinal');
    expect(stageOf('Doble-Octavos de final')).toBe('double_octofinal');
    expect(stageOf('Semifinal')).toBe('semifinal');
    expect(stageOf('Semifinales')).toBe('semifinal');
    expect(stageOf('Gran Final')).toBe('grand_final');
    expect(stageOf('Finales')).toBe('final');
  });

  test('Portuguese rounds classify to their real stage', () => {
    expect(stageOf('Semifinais')).toBe('semifinal');
    expect(stageOf('Semi-Finais')).toBe('semifinal');
    expect(stageOf('Quartas de Final')).toBe('quarterfinal');
    expect(stageOf('Oitavas de Final')).toBe('octofinal');
    expect(stageOf('Grande Final')).toBe('grand_final');
    expect(stageOf('Finais')).toBe('final');
  });

  test('a more specific stage always wins over the bare final fallback', () => {
    // Every one of these contains the substring "final".
    for (const [label, stage] of [
      ['Cuartos de Final', 'quarterfinal'],
      ['Octavos de Final', 'octofinal'],
      ['Doble-Octavos de final', 'double_octofinal'],
      ['Quartas de Final', 'quarterfinal'],
      ['Semifinais de Iniciados', 'semifinal'],
      ['Gran Final', 'grand_final'],
    ] as const) {
      expect(stageOf(label), label).toBe(stage);
    }
  });
});

describe('splitStageLabel — the tournament supplies its own categories', () => {
  // Break categories are free text chosen per tournament. Rather than keep
  // an allowlist that can never be complete, the stage phrase is matched and
  // whatever is left over IS the category.
  test('separates a known category from the stage', () => {
    expect(splitStageLabel('ESL Grand Final')).toEqual({ category: 'ESL', stage: 'grand_final' });
    expect(splitStageLabel('Novice Octofinals')).toEqual({ category: 'Novice', stage: 'octofinal' });
    expect(splitStageLabel('esl final')).toEqual({ category: 'ESL', stage: 'final' });
  });

  test('separates categories no allowlist would have contained', () => {
    expect(splitStageLabel('Gold Final')).toEqual({ category: 'Gold', stage: 'final' });
    expect(splitStageLabel('Bronze Finals')).toEqual({ category: 'Bronze', stage: 'final' });
    expect(splitStageLabel('HS Grand Finals')).toEqual({ category: 'HS', stage: 'grand_final' });
    expect(splitStageLabel('College Semifinals')).toEqual({ category: 'College', stage: 'semifinal' });
    expect(splitStageLabel('Elementary Quarterfinals')).toEqual({
      category: 'Elementary',
      stage: 'quarterfinal',
    });
    expect(splitStageLabel('English as a Second Language Finals')).toEqual({
      category: 'English as a Second Language',
      stage: 'final',
    });
  });

  test('reads a trailing category too', () => {
    // "Semifinais de Iniciados" — Portuguese puts the category after the
    // stage, joined by a connector.
    expect(splitStageLabel('Semifinais de Iniciados')).toEqual({
      category: 'Iniciados',
      stage: 'semifinal',
    });
    expect(splitStageLabel('Semifinais Novice')).toEqual({ category: 'Novice', stage: 'semifinal' });
  });

  test('a bare stage has no category', () => {
    expect(splitStageLabel('Grand Final')).toEqual({ category: null, stage: 'grand_final' });
    expect(splitStageLabel('Cuartos de Final')).toEqual({ category: null, stage: 'quarterfinal' });
    expect(splitStageLabel('Doble-Octavos de final')).toEqual({
      category: null,
      stage: 'double_octofinal',
    });
  });

  test('an unclassifiable label yields no stage and no category', () => {
    expect(splitStageLabel('Round 3')).toEqual({ category: null, stage: null });
    expect(splitStageLabel('')).toEqual({ category: null, stage: null });
  });
});
