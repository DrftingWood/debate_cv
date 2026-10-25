import { describe, expect, test } from 'vitest';
import { splitRounds, MIN_SPLIT_ROUNDS } from '@/lib/cv/roundSplits';
import { filterFacts, EMPTY_FILTER } from '@/lib/cv/statsFilter';
import type { RoundFact, TournamentFact } from '@/lib/cv/statsFacts';

const round = (o: Partial<RoundFact>): RoundFact => ({
  tournamentId: '1', year: 2024, format: 'British Parliamentary', round: 1, isOutround: false,
  seat: 'BP:OG', partners: ['Ann'], partnerGap: 0, proAm: 'peers', motionType: 'Policy',
  hasMotion: true, contextLed: false, infoSlide: false, score: 75, partnerScores: [75], points: 2, won: false,
  ...o,
});
const tournament = (o: Partial<TournamentFact>): TournamentFact => ({
  tournamentId: '1', name: 'T', year: 2024, format: 'British Parliamentary', partners: ['Ann'],
  partnerGap: 0, proAm: 'peers', broke: false, breakRank: null, deepestOutround: null, won: null,
  speakerRank: null, ...o,
});

describe('splitRounds', () => {
  test('groups prelim rounds by key with counts, averages and win rate', () => {
    const rows = splitRounds(
      [
        round({ seat: 'BP:OG', score: 76, won: true, points: 3 }),
        round({ seat: 'BP:OG', score: 74, won: false, points: 1, round: 2 }),
        round({ seat: 'BP:CG', score: 78, won: true, points: 3, round: 3, tournamentId: '2' }),
        round({ seat: 'BP:CG', score: 70, won: null, points: null, round: 10, isOutround: true }),
      ],
      (r) => r.seat,
    );
    expect(rows.find((r) => r.key === 'BP:OG')).toMatchObject({
      rounds: 2, tournaments: 1, speeches: 2, avgScore: 75, decided: 2, wins: 1, winRate: 0.5, avgPoints: 2,
    });
    // The outround is excluded: positions and types are read over prelims.
    expect(rows.find((r) => r.key === 'BP:CG')).toMatchObject({ rounds: 1, avgScore: 78 });
  });

  test('deltas are measured against your own figure in each round\'s format', () => {
    // BP baseline: score 75, win rate 0.25. AP baseline: score 80, win rate 0.75.
    const rounds = [
      round({ format: 'British Parliamentary', score: 75, won: true, motionType: 'Policy' }),
      round({ format: 'British Parliamentary', score: 75, won: false, motionType: 'Belief', round: 2 }),
      round({ format: 'British Parliamentary', score: 75, won: false, motionType: 'Belief', round: 3 }),
      round({ format: 'British Parliamentary', score: 75, won: false, motionType: 'Belief', round: 4 }),
      round({ format: 'Asian Parliamentary', seat: 'AP:Gov', score: 82, won: true, motionType: 'Policy', round: 5 }),
      round({ format: 'Asian Parliamentary', seat: 'AP:Gov', score: 78, won: true, motionType: 'Belief', round: 6 }),
      round({ format: 'Asian Parliamentary', seat: 'AP:Gov', score: 80, won: true, motionType: 'Belief', round: 7 }),
      round({ format: 'Asian Parliamentary', seat: 'AP:Gov', score: 80, won: false, motionType: 'Belief', round: 8 }),
    ];
    const policy = splitRounds(rounds, (r) => r.motionType).find((r) => r.key === 'Policy')!;
    // Score residuals: BP 75−75 = 0, AP 82−80 = +2 → mean +1.
    expect(policy.scoreDelta).toBeCloseTo(1);
    // Win residuals: BP 1−0.25 = +0.75, AP 1−0.75 = +0.25 → mean +0.5 → +50pp.
    expect(policy.winRateDelta).toBeCloseTo(50);
  });

  test('a row below the minimum sample is flagged thin', () => {
    expect(MIN_SPLIT_ROUNDS).toBe(6);
    const rows = splitRounds(
      Array.from({ length: 6 }, (_, i) => round({ round: i + 1 })).concat(round({ seat: 'BP:CO', round: 9 })),
      (r) => r.seat,
    );
    expect(rows.find((r) => r.key === 'BP:OG')!.thin).toBe(false);
    expect(rows.find((r) => r.key === 'BP:CO')!.thin).toBe(true);
  });

  test('rounds with no key are left out rather than bucketed as "unknown"', () => {
    const rows = splitRounds([round({ motionType: null }), round({ round: 2 })], (r) => r.motionType);
    expect(rows.map((r) => r.key)).toEqual(['Policy']);
  });

  test('BP points average ignores two-team rounds, which have no points', () => {
    const rows = splitRounds(
      [round({ points: 3 }), round({ round: 2, format: 'Australs', seat: 'Aus:Aff', points: null, won: true })],
      () => 'all',
    );
    expect(rows[0]).toMatchObject({ avgPoints: 3, decided: 2 });
  });
});

describe('filterFacts', () => {
  const facts = {
    partnerNames: {},
    tournaments: [
      tournament({ tournamentId: '1', partners: ['Ann'], proAm: 'pro' }),
      tournament({ tournamentId: '2', partners: ['Bob'], proAm: 'peers' }),
    ],
    rounds: [
      round({ tournamentId: '1', seat: 'BP:OG' }),
      round({ tournamentId: '1', seat: 'BP:CG', round: 2 }),
      round({ tournamentId: '2', seat: 'BP:OG' }),
    ],
  };

  test('no filter returns the facts untouched', () => {
    expect(filterFacts(facts, EMPTY_FILTER)).toBe(facts);
  });

  test('partner and pairing narrow tournaments and their rounds', () => {
    const out = filterFacts(facts, { ...EMPTY_FILTER, pairings: ['pro'] });
    expect(out.tournaments.map((t) => t.tournamentId)).toEqual(['1']);
    expect(out.rounds.map((r) => [r.tournamentId, r.seat])).toEqual([['1', 'BP:OG'], ['1', 'BP:CG']]);
  });

  test('seat narrows rounds and keeps only tournaments that still have one', () => {
    const out = filterFacts(facts, { ...EMPTY_FILTER, seats: ['BP:CG'] });
    expect(out.rounds.map((r) => [r.tournamentId, r.seat])).toEqual([['1', 'BP:CG']]);
    expect(out.tournaments.map((t) => t.tournamentId)).toEqual(['1']);
  });
});

describe('splitRounds — red-team regressions', () => {
  test('deltas under a filter compare with the whole record, not the filtered slice', () => {
    // Regression: filtering to one seat made the seat its own baseline, so
    // every delta read 0.0.
    const all = [
      ...Array.from({ length: 6 }, (_, i) => round({ seat: 'BP:OG', score: 77, won: true, round: i + 1 })),
      ...Array.from({ length: 6 }, (_, i) => round({ seat: 'BP:CO', score: 73, won: false, round: i + 10 })),
    ];
    const ogOnly = all.filter((r) => r.seat === 'BP:OG');
    const [og] = splitRounds(ogOnly, (r) => r.seat, all);
    expect(og.scoreDelta).toBeCloseTo(2);
    expect(og.winRateDelta).toBeCloseTo(50);
  });

  test('thin also counts the speeches and decided rounds each figure rests on', () => {
    const rows = Array.from({ length: 8 }, (_, i) => round({ round: i + 1, score: i === 0 ? 80 : null, won: null }));
    const [row] = splitRounds(rows, (r) => r.seat);
    expect(row.rounds).toBe(8);
    expect(row.thin).toBe(true);
  });

  test('a round is baselined by the format its seat names, when the two disagree', () => {
    // An "Asian Parliamentary" tab whose rooms had four seats is a BP room.
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => round({ format: 'British Parliamentary', score: 75, round: i + 1 })),
      round({ format: 'Asian Parliamentary', seat: 'BP:OG', score: 77, round: 20, tournamentId: '5' }),
      ...Array.from({ length: 6 }, (_, i) => round({ format: 'Asian Parliamentary', seat: 'AP:Gov', score: 80, round: 30 + i, tournamentId: '6' })),
    ];
    const mis = splitRounds(rows, (r) => (r.tournamentId === '5' ? 'mis' : null))[0];
    // Against BP (about 75.3) it is about +1.7; against AP (about 79.6) it would be -2.6.
    expect(mis.scoreDelta!).toBeGreaterThan(1);
  });
});
