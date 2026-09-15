import { describe, expect, test } from 'vitest';
import {
  assignMotionRounds,
  isPrelimRoundLabel,
  prelimRoundsFromNav,
  roundKey,
  speakerColumnRounds,
} from '@/lib/calicotab/roundNumbers';

const nav = (rounds: Array<[number, string]>) =>
  Object.fromEntries(rounds.map(([n, l]) => [`https://x.calicotab.com/t/results/round/${n}/`, l]));

describe('prelim rounds from the nav', () => {
  test('sequence order; outrounds and debate-offs left out', () => {
    const prelims = prelimRoundsFromNav(
      nav([[3, 'Round 2'], [1, 'Round 1A'], [2, 'Round 1B'], [4, 'Debate-off'], [5, 'Quarterfinals']]),
    );
    expect(prelims).toEqual([
      { number: 1, label: 'Round 1A' },
      { number: 2, label: 'Round 1B' },
      { number: 3, label: 'Round 2' },
    ]);
  });

  test('a numbered round is a prelim whatever else it says', () => {
    expect(isPrelimRoundLabel('Round 5 (Final Prelim)')).toBe(true);
    expect(isPrelimRoundLabel('Debate-off')).toBe(false);
    expect(prelimRoundsFromNav(undefined)).toEqual([]);
  });

  test('round keys', () => {
    expect(['Round 1A', 'R1A', 'Round 1-A', 'Round 1 A', 'round 1a'].map(roundKey)).toEqual(
      ['1a', '1a', '1a', '1a', '1a'],
    );
    expect(roundKey('Rodada 0')).toBe('0');
    expect(roundKey('Round 2A(Blind)')).toBe(null);
  });
});

describe('speaker score columns', () => {
  test('split rounds get a round each (anu spring21)', () => {
    const prelims = prelimRoundsFromNav(
      nav([[1, 'Round 1A'], [2, 'Round 1B'], [3, 'Round 2'], [4, 'Round 3'], [5, 'Round 4'], [6, 'Round 5']]),
    );
    expect(speakerColumnRounds(['R1A', 'R1B', 'R2', 'R3', 'R4', 'R5'], prelims)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('a split tab mid-tournament still lines up by name', () => {
    // Round 5's results not public yet: the counts differ, so position
    // cannot be trusted — the round names still can.
    const prelims = prelimRoundsFromNav(
      nav([[1, 'Round 1A'], [2, 'Round 1B'], [3, 'Round 2'], [4, 'Round 3'], [5, 'Round 4']]),
    );
    expect(speakerColumnRounds(['R1A', 'R1B', 'R2', 'R3', 'R4', 'R5'], prelims)).toEqual([1, 2, 3, 4, 5, null]);
  });

  test('interleaved halves are placed by name, not position (paqo2020)', () => {
    const prelims = prelimRoundsFromNav(
      nav([[1, 'Round 1a'], [2, 'Round 2a'], [3, 'Round 1b'], [4, 'Round 2b']]),
    );
    expect(speakerColumnRounds(['R1a', 'R1b', 'R2a', 'R2b'], prelims)).toEqual([1, 3, 2, 4]);
  });

  test('a zero-based round is not read as the average (cmdlp2021)', () => {
    const prelims = prelimRoundsFromNav(nav([[1, 'Rodada 0'], [2, 'Rodada 1'], [3, 'Rodada 2']]));
    expect(speakerColumnRounds(['R0', 'R1', 'R2'], prelims)).toEqual([1, 2, 3]);
    // Mid-tournament: "Rodada 2" not released. Names still decide.
    const partial = prelimRoundsFromNav(nav([[1, 'Rodada 0'], [2, 'Rodada 1']]));
    expect(speakerColumnRounds(['R0', 'R1', 'R2'], partial)).toEqual([1, 2, null]);
  });

  test('repeated labels fall to position when the counts agree (hwsrr2023)', () => {
    const prelims = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 1'], [3, 'Round 2'], [4, 'Round 2']]));
    expect(speakerColumnRounds(['R1', 'R1', 'R2', 'R2'], prelims)).toEqual([1, 2, 3, 4]);
  });

  test('ordinary tabs are unchanged, including a debate-off in the nav (australs2026)', () => {
    const prelims = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 2'], [3, 'Debate-off']]));
    expect(speakerColumnRounds(['R1', 'R2'], prelims)).toEqual([1, 2]);
  });

  test('the label digit is used only where it cannot lie', () => {
    // No nav at all: the digit is all there is.
    expect(speakerColumnRounds(['R1', 'R2'], [])).toEqual([1, 2]);
    expect(speakerColumnRounds(['R0'], [])).toEqual([null]);
    // Nav whose labels are not numbered, tab short a column: position is
    // unsafe, but every nav label is "Round N"@N-consistent, so digits hold.
    const prelims = prelimRoundsFromNav(nav([[1, 'Round One'], [2, 'Round Two'], [3, 'Round Three']]));
    expect(speakerColumnRounds(['R1', 'R2'], prelims)).toEqual([1, 2]);
  });

  test('outround columns are skipped', () => {
    const prelims = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 2']]));
    expect(speakerColumnRounds(['R1', 'R2', 'Semifinals'], prelims)).toEqual([1, 2, null]);
  });
});

describe('motion rounds', () => {
  const prelims = prelimRoundsFromNav(
    nav([[1, 'Round 1A'], [2, 'Round 1B'], [3, 'Round 2'], [4, 'Semifinals']]),
  );

  test('a motion takes the round its label names in the nav', () => {
    expect(
      assignMotionRounds(
        [
          { roundLabel: 'Round 1A', roundNumber: null },
          { roundLabel: 'round  1b', roundNumber: null },
          { roundLabel: 'Round 2', roundNumber: 2 },
          { roundLabel: 'Semifinals', roundNumber: null },
        ],
        prelims,
      ),
    ).toEqual([1, 2, 3, null]);
  });

  test('a repeated label is resolved by heading order (hwsrr2023)', () => {
    const dup = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 1'], [3, 'Round 2'], [4, 'Round 2']]));
    expect(
      assignMotionRounds(
        [
          { roundLabel: 'Round 1', roundNumber: 1, roundIndex: 0 },
          { roundLabel: 'Round 1', roundNumber: 1, roundIndex: 0 }, // second motion, same room set
          { roundLabel: 'Round 1', roundNumber: 1, roundIndex: 1 },
          { roundLabel: 'Round 2', roundNumber: 2, roundIndex: 2 },
          { roundLabel: 'Round 2', roundNumber: 2, roundIndex: 3 },
        ],
        dup,
      ),
    ).toEqual([1, 1, 2, 3, 4]);
    // Without headings it cannot be decided.
    expect(assignMotionRounds([{ roundLabel: 'Round 1', roundNumber: 1 }], dup)).toEqual([null]);
  });

  test('a round missing from the nav keeps its number only where digits are safe', () => {
    const plain = prelimRoundsFromNav(nav([[1, 'Round 1'], [2, 'Round 2']]));
    expect(assignMotionRounds([{ roundLabel: 'Round 9', roundNumber: 9 }], plain)).toEqual([9]);
    // Split tournament: "Round 5" is not URL 5.
    expect(assignMotionRounds([{ roundLabel: 'Round 5', roundNumber: 5 }], prelims)).toEqual([null]);
  });
});
