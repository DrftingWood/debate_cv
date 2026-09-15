import { describe, expect, test } from 'vitest';
import { isPreRound, matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';
import { classifyRoundLabel, outroundRankStrict } from '@/lib/calicotab/judgeStats';
import { deepestOutroundsByCategory } from '@/lib/calicotab/breakCategoryResolve';
import { formatStageForDisplay } from '@/lib/cv/formatStage';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;
const catOf = (s: string) => splitStageLabel(s).category;
const rankOf = (s: string) => outroundRankStrict(s)!;

describe('"Partial X" is rung X run with byes', () => {
  test('each partial round is its own rung, partially', () => {
    expect(stageOf('Partial Semifinals')).toBe('partial_semifinal');
    expect(stageOf("Partial Semi's")).toBe('partial_semifinal');
    expect(stageOf('Partial Quarterfinals')).toBe('partial_quarterfinal');
    expect(stageOf('ESL Partial Quarters')).toBe('partial_quarterfinal');
    expect(stageOf('Partial Octofinals')).toBe('partial_octofinal');
    expect(stageOf('Partial Double-Octofinals')).toBe('partial_double_octofinal');
    expect(stageOf('Partial Triple Octofinals')).toBe('partial_triple_octofinal');
  });

  test('a double rung partially is the partial of the rung it is', () => {
    // A double quarterfinal is the octofinal; EUDC's "Partial Double
    // Quarters" is followed by Quarterfinals at all 7 corpus tournaments.
    expect(stageOf('Partial Double Quarters')).toBe('partial_octofinal');
    expect(stageOf('Partial-double Quarterfinals')).toBe('partial_octofinal');
    expect(stageOf('Partial Double QF')).toBe('partial_octofinal');
    expect(stageOf('Partial Double Semifinals')).toBe('partial_quarterfinal');
    expect(stageOf('Partial Double SF')).toBe('partial_quarterfinal');
  });

  test('short forms: "Octos" / "Octas" do not drop the double', () => {
    // "Partial Double Octos" read as a partial OCTOfinal and outranked the
    // double-octofinal it feeds.
    expect(stageOf('Double Octos')).toBe('double_octofinal');
    expect(stageOf('Partial Double Octos')).toBe('partial_double_octofinal');
    expect(stageOf('Partial Triple-Octos')).toBe('partial_triple_octofinal');
    expect(stageOf('Open Partial Double Octas')).toBe('partial_double_octofinal');
  });

  test('Spanish and Portuguese, singular and plural', () => {
    expect(stageOf('Octavos Parcial')).toBe('partial_octofinal');
    expect(stageOf('Octavos Parciales')).toBe('partial_octofinal');
    expect(stageOf('Cuartos de Final Parciales')).toBe('partial_quarterfinal');
    expect(stageOf('Oitavas Parciais')).toBe('partial_octofinal');
    expect(stageOf('Dobles Octavos Parciales')).toBe('partial_double_octofinal');
  });

  test('ranked below the full rung, above the rung beneath, never tied', () => {
    expect(rankOf('Partial Quarterfinals')).toBeLessThan(rankOf('Quarterfinals'));
    expect(rankOf('Partial Quarterfinals')).toBeGreaterThan(rankOf('Octofinals'));
    expect(rankOf('Partial Double Octos')).toBeLessThan(rankOf('Double Octofinals'));
    expect(rankOf('Partial Double Octofinals')).toBeGreaterThan(rankOf('Triple Octofinals'));
    const ranks = [
      'Grand Final', 'Final', 'Semifinals', 'Partial Semifinals', 'Quarterfinals',
      'Partial Quarterfinals', 'Octofinals', 'Partial Octofinals', 'Double Octofinals',
      'Partial Double Octofinals', 'Triple Octofinals', 'Partial Triple Octofinals',
    ].map(rankOf);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  test('deepest outround does not depend on the order rounds are listed', () => {
    const rank = (s: string) => rankOf(s);
    const a = deepestOutroundsByCategory(['Pre-Quarterfinals', 'Partial Double Quarters'], rank);
    const b = deepestOutroundsByCategory(['Partial Double Quarters', 'Pre-Quarterfinals'], rank);
    expect(formatStageForDisplay(a[0]!.stage)).toBe(formatStageForDisplay(b[0]!.stage));
  });

  test('it counts as a partial round', () => {
    expect(isPreRound('Partial Octofinals')).toBe(true);
    expect(isPreRound('Partial Double Octofinals')).toBe(true);
    expect(isPreRound('Octofinals')).toBe(false);
    expect(isPreRound('Impartial Octofinals')).toBe(false);
  });
});

describe('modifiers are never a category', () => {
  test('bare, bracketed, hyphenated or plural', () => {
    expect(catOf('Partial Octofinals')).toBe(null);
    expect(catOf('Partial Double Quarterfinals')).toBe(null);
    expect(catOf("Partial Semi's")).toBe(null);
    expect(catOf("Partial Double Semi's")).toBe(null);
    expect(catOf('Octofinals (Partial)')).toBe(null);
    expect(catOf('Round of 16 (partial)')).toBe(null);
    expect(catOf('Partial-Double-Octos')).toBe(null);
    expect(catOf('Double-Partial Octofinals')).toBe(null);
    expect(catOf('Octavos Parciales')).toBe(null);
    expect(catOf('Dobles Octavos Parciales')).toBe(null);
  });

  test('a real category survives beside them', () => {
    expect(splitStageLabel('Novice Partial Semis')).toEqual({ category: 'Novice', stage: 'partial_semifinal' });
    expect(splitStageLabel('ESL Partial Double Quarters')).toEqual({ category: 'ESL', stage: 'partial_octofinal' });
    expect(catOf('Pro-Am Partial Octofinals')).toBe('Pro-Am');
    expect(catOf('Double Trouble Final')).toBe('Trouble');
  });
});

describe('display: one name per round, stable when re-read', () => {
  test('every partial round shows as "Partial <rung>"', () => {
    expect(formatStageForDisplay('Partial Double-Octofinals')).toBe('Partial Double Octofinals');
    expect(formatStageForDisplay('Partial Double Quarters')).toBe('Partial Octofinals');
    expect(formatStageForDisplay('ESL Partial Double Quarters')).toBe('ESL Partial Octofinals');
    expect(formatStageForDisplay('Partial Double Semifinals')).toBe('Partial Quarterfinals');
    expect(formatStageForDisplay('Octofinals (Partial)')).toBe('Partial Octofinals');
  });

  test('formatting a formatted label changes nothing', () => {
    for (const label of [
      'Partial Double Quarters', 'Pre-Quarterfinals', 'Partial Double Octos', 'ESL Pre-Semifinals',
      'Octavos Parciales', 'Partial Triple Octofinals', 'Novice Partial Semis',
    ]) {
      const once = formatStageForDisplay(label);
      expect(formatStageForDisplay(once), label).toBe(once);
      expect(stageOf(once), label).toBe(stageOf(label));
    }
  });
});

describe('"double" names a real rung', () => {
  test('a double quarterfinal is an octofinal, a double semifinal a quarterfinal', () => {
    expect(stageOf('Double Quarterfinals')).toBe('octofinal');
    expect(stageOf('Double Quarters')).toBe('octofinal');
    expect(stageOf('Double QF')).toBe('octofinal');
    expect(stageOf('Double Semis')).toBe('quarterfinal');
    expect(stageOf('Double Semifinals')).toBe('quarterfinal');
    expect(stageOf('Double SF')).toBe('quarterfinal');
  });
});

describe('a numbered round is a prelim, whatever else it says', () => {
  test('never an outround', () => {
    expect(stageOf('Round 5 (Final Prelim)')).toBe(null);
    expect(stageOf('Round 6 (Semi-Final Qualifier)')).toBe(null);
    expect(stageOf('Round 2 | GF Debating Cup')).toBe(null);
    expect(stageOf('Round of 16')).toBe('octofinal');
  });

  test('the older classifier agrees with the lexicon', () => {
    expect(classifyRoundLabel('Partial Double Quarters')).toBe('outround');
    expect(classifyRoundLabel('Pre-Octofinals')).toBe('outround');
    expect(classifyRoundLabel('Double-Octofinals')).toBe('outround');
    expect(classifyRoundLabel('Round 1A')).toBe('inround');
    expect(classifyRoundLabel('Round 1-B')).toBe('inround');
    expect(classifyRoundLabel('Rodada 0')).toBe('inround');
    expect(classifyRoundLabel('R1A')).toBe('inround');
  });
});

describe('ordinary stages are untouched', () => {
  test('plain rounds keep their stage and have no category', () => {
    expect(stageOf('Quarterfinals')).toBe('quarterfinal');
    expect(stageOf('Semifinals')).toBe('semifinal');
    expect(stageOf('Octofinals')).toBe('octofinal');
    expect(catOf('Quarterfinals')).toBe(null);
  });

  test('a real category is still read and cased', () => {
    expect(catOf('Gold Final')).toBe('Gold');
    expect(catOf('ESL Grand Final')).toBe('ESL');
    expect(catOf('hs Grand Final')).toBe('HS');
    expect(catOf('pro Final')).toBe('Pro');
    expect(catOf('u16 Final')).toBe('U16');
  });
});
