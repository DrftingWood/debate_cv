import { describe, expect, test } from 'vitest';
import { momentumAfter } from '@/lib/cv/roundViews';
import type { RoundFact } from '@/lib/cv/statsFacts';

const round = (o: Partial<RoundFact>): RoundFact => ({
  tournamentId: '1', year: 2024, format: 'British Parliamentary', round: 1, isOutround: false,
  seat: 'BP:OG', partners: ['Ann'], partnerGap: 0, proAm: 'peers', motionType: 'Policy',
  hasMotion: true, contextLed: false, infoSlide: false, score: 75, partnerScores: [75], points: 2, won: false,
  ...o,
});

describe('momentumAfter', () => {
  test('pairs each decided prelim with the next round of the same tournament', () => {
    const m = momentumAfter([
      round({ round: 1, won: true }),
      round({ round: 2, won: true, score: 78 }), // after a win
      round({ round: 3, won: false, score: 72 }), // after a win
      round({ round: 4, won: true, score: 76 }), // after a loss
      round({ round: 5, won: null }), // after a win: its score counts, but no outcome, and it can't be a "previous"
      round({ round: 6, won: true }), // previous round undecided → not paired
      round({ round: 7, isOutround: true, won: true }), // outround never paired
      round({ tournamentId: '2', round: 1, won: false }), // a new tournament starts fresh
    ]);
    const afterWin = m.find((r) => r.key === 'after-win')!;
    const afterLoss = m.find((r) => r.key === 'after-loss')!;
    expect(afterWin).toMatchObject({ rounds: 3, wins: 1, decided: 2 });
    expect(afterWin.avgScore).toBeCloseTo(75);
    expect(afterLoss).toMatchObject({ rounds: 1, wins: 1 });
  });

  test('a gap in round numbers (a bye, an unrecorded round) breaks the pair', () => {
    const m = momentumAfter([round({ round: 1, won: true }), round({ round: 3, won: true })]);
    expect(m).toEqual([]);
  });

  test('pairs are read from the whole tournament even when only some rounds are shown', () => {
    // Filtering is by tournament (partner / pairing), never by seat, but the
    // function must not depend on the order rounds arrive in.
    const m = momentumAfter([round({ round: 2, won: false }), round({ round: 1, won: true })]);
    expect(m.find((r) => r.key === 'after-win')).toMatchObject({ rounds: 1, wins: 0 });
  });
});
