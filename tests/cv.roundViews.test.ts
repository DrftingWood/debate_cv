import { describe, expect, test } from 'vitest';
import { carryIndex, CARRY_LEVEL_BAND, roundCurve } from '@/lib/cv/roundViews';
import type { RoundFact } from '@/lib/cv/statsFacts';

const round = (o: Partial<RoundFact>): RoundFact => ({
  tournamentId: '1',
  year: 2024,
  format: 'British Parliamentary',
  round: 1,
  isOutround: false,
  seat: 'BP:OG',
  partners: ['Ann'],
  partnerGap: 0,
  proAm: 'unmarked',
  motionType: 'Policy',
  hasMotion: true,
  contextLed: false,
  infoSlide: false,
  score: 75,
  partnerScores: [75],
  points: 2,
  won: false,
  ...o,
});

describe('roundCurve', () => {
  test('one row per prelim round number, in numeric order, outrounds left out', () => {
    const rows = roundCurve([
      round({ round: 10, score: 78 }),
      round({ round: 2, score: 74 }),
      round({ round: 9, score: 76 }),
      round({ round: 11, isOutround: true }),
    ]);
    expect(rows.map((r) => r.roundNumber)).toEqual([2, 9, 10]);
    expect(rows[2]).toMatchObject({ roundNumber: 10, rounds: 1, avgScore: 78 });
  });

  test('deltas use the baseline rounds, not only the rounds shown', () => {
    const all = [round({ round: 1, score: 80 }), round({ round: 2, score: 70 })];
    const [r1] = roundCurve([all[0]], all);
    expect(r1.scoreDelta).toBeCloseTo(5);
  });
});

describe('carryIndex', () => {
  test('carry is your speech minus the mean of your partners in the same round', () => {
    const c = carryIndex([
      round({ score: 78, partnerScores: [75] }), // +3
      round({ round: 2, score: 76, partnerScores: [77, 75] }), // three a side: 76 − 76 = 0
      round({ round: 3, score: 74, partnerScores: [] }), // no partner scored: not counted
      round({ round: 4, score: null, partnerScores: [75] }), // you weren't scored: not counted
      round({ round: 5, isOutround: true, score: 90, partnerScores: [70] }),
    ]);
    expect(c.rounds).toBe(2);
    expect(c.meanCarry).toBeCloseTo(1.5);
    expect(c.outSpoke).toBe(1);
    expect(c.level).toBe(1);
    expect(c.outSpoken).toBe(0);
  });

  test(`within ±${CARRY_LEVEL_BAND} is level, beyond it out-speaking or out-spoken`, () => {
    // Half a point: tabs score in half or whole points, so a one-point gap is
    // the smallest difference most judges express, and it is a real one.
    expect(CARRY_LEVEL_BAND).toBe(0.5);
    const c = carryIndex([
      round({ score: 75.5, partnerScores: [75] }), // exactly +0.5 → level
      round({ round: 2, score: 76, partnerScores: [75] }), // +1 → out-spoke
      round({ round: 3, score: 74, partnerScores: [75] }), // −1 → out-spoken
    ]);
    expect([c.outSpoke, c.level, c.outSpoken]).toEqual([1, 1, 1]);
  });

  test('a carry on the band after averaging three-a-side partners stays level', () => {
    // 70.7 − mean(70.1, 70.3) is 0.5000000000000142 and 70.3 − mean(70.4, 71.2)
    // is −0.5000000000000142 in floating point; both are exactly the band.
    const c = carryIndex([
      round({ score: 70.7, partnerScores: [70.1, 70.3] }),
      round({ round: 2, score: 70.3, partnerScores: [70.4, 71.2] }),
    ]);
    expect(c.level).toBe(2);
  });

  test('results by bucket carry per-format deltas against the baseline', () => {
    const rounds = [
      ...Array.from({ length: 6 }, (_, i) =>
        round({ round: i + 1, score: 78, partnerScores: [75], won: true }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        round({ round: i + 10, score: 72, partnerScores: [75], won: false }),
      ),
    ];
    const c = carryIndex(rounds);
    const out = c.results.find((r) => r.key === 'out-spoke')!;
    const under = c.results.find((r) => r.key === 'out-spoken')!;
    expect(out).toMatchObject({ rounds: 6, winRate: 1 });
    expect(out.winRateDelta).toBeCloseTo(50);
    expect(under.winRateDelta).toBeCloseTo(-50);
  });

  test('nothing comparable, nothing to say', () => {
    expect(carryIndex([round({ partnerScores: [] })])).toMatchObject({
      rounds: 0,
      meanCarry: null,
      results: [],
    });
  });
});
