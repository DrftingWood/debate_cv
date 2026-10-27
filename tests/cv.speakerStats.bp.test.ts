import { describe, expect, test } from 'vitest';
import { computeSpeakerStats, deriveQuirks } from '@/lib/cv/speakerStats';
import { makeSpeakerRow } from './setup/cv-fixtures';

// Owner decision (assumptions I1, C40, C41): a British Parliamentary prelim is
// never a "win". The headline is STRAIGHTS (points total >= 2 x rounds); firsts
// are tracked separately.

const BP = 'British Parliamentary';
const AP = 'Asian Parliamentary';

/** One result row per round: BP stores won = (points === 3). */
const bpRounds = (points: number[]) =>
  points.map((p, i) => ({ roundNumber: i + 1, position: 'OG', won: p === 3, points: p }));
const apRounds = (wins: boolean[]) =>
  wins.map((w, i) => ({ roundNumber: i + 1, position: 'Gov', won: w, points: null }));

describe('BP rounds are 2nd-or-better, never wins', () => {
  test('a team placing 2nd in every room has a 100% rate and zero firsts', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 5,
          teamPoints: '10',
          teamRoundResults: bpRounds([2, 2, 2, 2, 2]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.outcome).toBe('top-two');
    expect(s.results.winRate).toBe(1);
    expect(s.results.longestWinStreak).toBe(5);
    expect(s.results.bp).toMatchObject({
      rounds: 5,
      firsts: 0,
      tournaments: 1,
      straights: 1,
      straightsRate: 1,
    });
  });

  test('3,0,3,0 is two firsts and two top-two rounds but NOT straights (6 < 8)', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 4,
          teamPoints: '6',
          teamRoundResults: bpRounds([3, 0, 3, 0]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.bp).toMatchObject({
      rounds: 4,
      firsts: 2,
      firstsRate: 0.5,
      tournaments: 1,
      straights: 0,
    });
    expect(s.results.wins).toBe(2);
    expect(s.results.longestWinStreak).toBe(1);
  });

  test('exactly 2 x rounds is straights; one point short is not', () => {
    const at = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 5,
          teamPoints: '10',
          teamRoundResults: bpRounds([3, 3, 1, 2, 1]),
        }),
      ],
      judgeRows: [],
    });
    const short = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 5,
          teamPoints: '9',
          teamRoundResults: bpRounds([3, 3, 1, 1, 1]),
        }),
      ],
      judgeRows: [],
    });
    expect(at.results.bp?.straights).toBe(1);
    expect(short.results.bp?.straights).toBe(0);
  });

  test('without a tab total the rounds are summed, but only when every prelim has points', () => {
    const summed = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 3,
          teamPoints: null,
          teamRoundResults: bpRounds([2, 2, 2]),
        }),
      ],
      judgeRows: [],
    });
    expect(summed.results.bp?.straights).toBe(1);
    const missing = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 3,
          teamPoints: null,
          teamRoundResults: bpRounds([3, 3]),
        }),
      ],
      judgeRows: [],
    });
    // 2 of 3 rounds known: judging straights would understate the total, so it is left out.
    expect(missing.results.bp?.tournaments).toBe(0);
  });

  test('two-team formats still count wins and carry no BP block', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: AP,
          prelimRoundCount: 3,
          teamPoints: null,
          teamRoundResults: apRounds([true, true, false]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.outcome).toBe('win');
    expect(s.results.wins).toBe(2);
    expect(s.results.bp).toBeNull();
  });

  test('a mixed career is labelled mixed and keeps BP firsts out of the win count', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 1n,
          format: BP,
          prelimRoundCount: 2,
          teamPoints: '5',
          teamRoundResults: bpRounds([3, 2]),
        }),
        makeSpeakerRow({
          tournamentId: 2n,
          format: AP,
          prelimRoundCount: 2,
          teamPoints: null,
          teamRoundResults: apRounds([true, false]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.outcome).toBe('mixed');
    expect(s.results.bp?.firsts).toBe(1);
  });
});

describe('findings use straights wording for BP', () => {
  test('a BP run of five in-rounds says 2nd or better, never "won"; four is not enough', () => {
    const four = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 4,
          teamPoints: '8',
          teamRoundResults: bpRounds([2, 2, 2, 2]),
        }),
      ],
      judgeRows: [],
    });
    expect(deriveQuirks(four).some((q) => q.id === 'streak')).toBe(false);

    const five = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 5,
          teamPoints: '10',
          teamRoundResults: bpRounds([2, 2, 2, 2, 2]),
        }),
      ],
      judgeRows: [],
    });
    const streak = deriveQuirks(five).find((q) => q.id === 'streak');
    expect(streak?.text).toMatch(/2nd or better is 5/);
    expect(streak?.text).not.toMatch(/won|win/);
  });

  test('outrounds never extend a streak', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 3,
          teamPoints: '6',
          teamRoundResults: bpRounds([2, 2, 2, 2, 2, 2]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.longestWinStreak).toBe(3);
    expect(deriveQuirks(s).some((q) => q.id === 'streak')).toBe(false);
  });

  test('a two-team run of five is still a streak finding in "won rounds" wording', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: AP,
          prelimRoundCount: 5,
          teamRoundResults: apRounds([true, true, true, true, true]),
        }),
      ],
      judgeRows: [],
    });
    expect(deriveQuirks(s).find((q) => q.id === 'streak')?.text).toBe(
      'Your longest run of won rounds is 5.',
    );
  });

  test('straights finding appears once there are enough BP tournaments', () => {
    const rows = [1n, 2n, 3n, 4n].map((id, i) =>
      makeSpeakerRow({
        tournamentId: id,
        format: BP,
        prelimRoundCount: 3,
        teamPoints: i < 2 ? '6' : '3',
        teamRoundResults: bpRounds(i < 2 ? [2, 2, 2] : [1, 1, 1]),
      }),
    );
    const q = deriveQuirks(computeSpeakerStats({ speakerRows: rows, judgeRows: [] })).find(
      (x) => x.id === 'straights',
    );
    expect(q?.text).toContain('50%');
    expect(q?.basis).toContain('2 of 4 BP tournaments');
  });
});

describe('BP outrounds stay out of the prelim measures', () => {
  test('outround rows are excluded from decidedRounds, wins and the rate', () => {
    const prelims = [1, 2, 3, 4, 5].map((n) => ({
      roundNumber: n,
      position: 'OG',
      won: false,
      points: 1,
    }));
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: 5,
          teamPoints: '5',
          teamRoundResults: [
            ...prelims,
            { roundNumber: 6, position: 'OG', won: true, points: null },
            { roundNumber: 7, position: 'OG', won: false, points: null },
          ],
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.decidedRounds).toBe(5);
    expect(s.results.wins).toBe(0);
    expect(s.results.winRate).toBe(0);
  });

  test('straights with no prelim count never sums outround points', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: BP,
          prelimRoundCount: null,
          teamPoints: null,
          teamRoundResults: bpRounds([1, 1, 1, 3, 3]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.bp?.tournaments ?? 0).toBe(0);
  });

  test('BP seats with an unknown format get the same top-two wording and straights', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          format: null,
          prelimRoundCount: 3,
          teamPoints: '6',
          teamRoundResults: [1, 2, 3].map((n) => ({
            roundNumber: n,
            position: 'OG',
            won: false,
            points: 2,
          })),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.outcome).toBe('top-two');
    expect(s.results.bp).toMatchObject({ tournaments: 1, straights: 1 });
  });
});
