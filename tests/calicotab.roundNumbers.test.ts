import { describe, expect, test } from 'vitest';
import {
  motionRoundNumber,
  prelimRoundsFromNav,
  speakerColumnRounds,
} from '@/lib/calicotab/roundNumbers';

const nav = (rounds: Array<[number, string]>) =>
  Object.fromEntries(rounds.map(([n, l]) => [`https://x.calicotab.com/t/results/round/${n}/`, l]));

describe('prelim rounds from the nav', () => {
  test('sequence order, outrounds left out', () => {
    const prelims = prelimRoundsFromNav(
      nav([[3, 'Round 2'], [1, 'Round 1A'], [2, 'Round 1B'], [4, 'Quarterfinals']]),
    );
    expect(prelims).toEqual([
      { number: 1, label: 'Round 1A' },
      { number: 2, label: 'Round 1B' },
      { number: 3, label: 'Round 2' },
    ]);
  });

  test('nothing to read is no rounds', () => {
    expect(prelimRoundsFromNav(undefined)).toEqual([]);
  });
});

describe('speaker score columns', () => {
  test('split rounds get a round each (anu spring21)', () => {
    // R1A and R1B both read as round 1 and one of them was dropped.
    const prelims = prelimRoundsFromNav(
      nav([[1, 'Round 1A'], [2, 'Round 1B'], [3, 'Round 2'], [4, 'Round 3'], [5, 'Round 4'], [6, 'Round 5']]),
    );
    const map = speakerColumnRounds(['R1A', 'R1B', 'R2', 'R3', 'R4', 'R5'], prelims);
    expect([...map.entries()]).toEqual([
      ['R1A', 1], ['R1B', 2], ['R2', 3], ['R3', 4], ['R4', 5], ['R5', 6],
    ]);
  });

  test('a zero-based round is not read as the average (cmdlp2021)', () => {
    const prelims = prelimRoundsFromNav(nav([[1, 'Rodada 0'], [2, 'Rodada 1'], [3, 'Rodada 2']]));
    expect(speakerColumnRounds(['R0', 'R1', 'R2'], prelims).get('R0')).toBe(1);
  });

  test('ordinary tabs are unchanged', () => {
    const prelims = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 2']]));
    expect([...speakerColumnRounds(['R1', 'R2', 'R1', 'R2'], prelims).entries()]).toEqual([['R1', 1], ['R2', 2]]);
  });

  test('when the counts differ, the label number is all there is', () => {
    // australs2026: the nav also lists a "Debate-off".
    const prelims = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 2'], [3, 'Debate-off']]));
    const map = speakerColumnRounds(['R1', 'R2'], prelims);
    expect([...map.entries()]).toEqual([['R1', 1], ['R2', 2]]);
    expect(speakerColumnRounds(['R0'], []).has('R0')).toBe(false);
  });
});

describe('motion rounds', () => {
  const prelims = prelimRoundsFromNav(
    nav([[1, 'Round 1A'], [2, 'Round 1B'], [3, 'Round 2'], [4, 'Semifinals']]),
  );

  test('a motion takes the round its label names in the nav', () => {
    expect(motionRoundNumber('Round 1A', null, prelims)).toBe(1);
    expect(motionRoundNumber('round  1b', null, prelims)).toBe(2);
    expect(motionRoundNumber('Round 2', 2, prelims)).toBe(3);
  });

  test('otherwise the parsed number stands', () => {
    expect(motionRoundNumber('Semifinals', null, prelims)).toBe(null);
    expect(motionRoundNumber('Round 9', 9, prelims)).toBe(9);
  });

  test('a label the nav uses twice decides nothing (hwsrr2023)', () => {
    const dup = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 1']]));
    expect(motionRoundNumber('Round 1', 1, dup)).toBe(1);
  });
});
