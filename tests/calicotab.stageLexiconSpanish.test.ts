import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';

// Owner (assumptions I23/I25, ingest Q14, 2026-10-27): English is the default
// but at least one Spanish-language competition exists, so the Spanish stage
// names sit beside the English, Portuguese and Chinese/Japanese ones.

const stageOf = (label: string) => matchStage(label)?.stage ?? null;

describe('Spanish stage names', () => {
  test.each([
    ['Final', 'final'],
    ['Gran Final', 'grand_final'],
    ['Semifinal', 'semifinal'],
    ['Semifinales', 'semifinal'],
    ['Semi-finales', 'semifinal'],
    ['Semis', 'semifinal'],
    ['Cuartos', 'quarterfinal'],
    ['Cuartos de Final', 'quarterfinal'],
    ['Cuartos de Finales', 'quarterfinal'],
    ['Octavos', 'octofinal'],
    ['Octavos de Final', 'octofinal'],
    ['Dieciseisavos', 'double_octofinal'],
    ['Dieciseisavos de Final', 'double_octofinal'],
    ['Dobles Octavos', 'double_octofinal'],
    ['Treintaidosavos', 'triple_octofinal'],
    ['Treintaidosavos de Final', 'triple_octofinal'],
  ] as const)('%s is %s', (label, stage) => {
    expect(stageOf(label)).toBe(stage);
  });

  test('"Cuartos de Final" is the quarterfinal, never the final', () => {
    expect(stageOf('Cuartos de Final')).not.toBe('final');
    expect(stageOf('Octavos de Final')).not.toBe('final');
  });

  test('the pre-rounds name the partial round of the rung below', () => {
    expect(stageOf('Prefinal')).toBe('partial_semifinal');
    expect(stageOf('Pre-semifinales')).toBe('partial_quarterfinal');
    expect(stageOf('Precuartos')).toBe('partial_octofinal');
    expect(stageOf('Pre-cuartos de final')).toBe('partial_octofinal');
    expect(stageOf('Preoctavos')).toBe('partial_double_octofinal');
    expect(stageOf('Pre-octavos de final')).toBe('partial_double_octofinal');
  });

  test('the category is whatever is left over', () => {
    expect(splitStageLabel('Gran Final Abierta')).toEqual({
      category: 'Abierta',
      stage: 'grand_final',
    });
    expect(splitStageLabel('Cuartos de Final Novatos')).toEqual({
      category: 'Novatos',
      stage: 'quarterfinal',
    });
    expect(splitStageLabel('Dieciseisavos de Final')).toEqual({
      category: null,
      stage: 'double_octofinal',
    });
  });

  test('a numbered Spanish round is a prelim, and "Debate-off" is still the only tie-break name', () => {
    expect(stageOf('Ronda 3')).toBeNull();
    expect(stageOf('Debate-off')).toBeNull();
    expect(stageOf('Desempate')).toBeNull();
  });
});
