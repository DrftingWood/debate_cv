import { describe, expect, test } from 'vitest';
import {
  computeJudgeAggregates,
  type JudgeRound,
} from '@/lib/calicotab/judgeAggregates';

describe('computeJudgeAggregates', () => {
  test('returns zeros and nulls for empty rounds', () => {
    const result = computeJudgeAggregates([]);
    expect(result).toEqual({
      chairedPrelims: 0,
      deepestChaired: null,
      deepestPaneled: null,
    });
  });

  test('counts prelim rounds chaired (roundNumber != null, role=chair)', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Round 1', role: 'chair', roundNumber: 1 },
      { stage: 'Round 2', role: 'chair', roundNumber: 2 },
      { stage: 'Round 3', role: 'panellist', roundNumber: 3 },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.chairedPrelims).toBe(2);
    expect(result.deepestChaired).toBeNull();
    expect(result.deepestPaneled).toBeNull();
  });

  test('picks deepest chaired outround by outroundRankStrict', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Quarterfinals', role: 'chair', roundNumber: null },
      { stage: 'Semifinals', role: 'chair', roundNumber: null },
      { stage: 'Octofinals', role: 'chair', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.deepestChaired).toBe('Semifinals');
  });

  test('picks deepest paneled outround (panellist OR trainee count)', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Octofinals', role: 'panellist', roundNumber: null },
      { stage: 'Semifinals', role: 'trainee', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.deepestPaneled).toBe('Semifinals');
  });

  test('separates chaired and paneled — chair role never lands in deepestPaneled', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Grand Final', role: 'chair', roundNumber: null },
      { stage: 'Quarterfinals', role: 'panellist', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.deepestChaired).toBe('Grand Final');
    expect(result.deepestPaneled).toBe('Quarterfinals');
  });

  test('ignores outrounds whose stage outroundRankStrict cannot rank', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Mystery Round', role: 'chair', roundNumber: null },
      { stage: 'Finals', role: 'chair', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    // Mystery Round won't rank; Finals will. deepestChaired is 'Finals'.
    expect(result.deepestChaired).toBe('Finals');
  });
});
