import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;
const catOf = (s: string) => splitStageLabel(s).category;

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
