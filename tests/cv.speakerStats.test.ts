import { describe, expect, test } from 'vitest';
import {
  computeSpeakerStats,
  buildBins,
  deriveQuirks,
} from '@/lib/cv/speakerStats';
import type { CvFieldStat } from '@/lib/cv/buildCvData';
import { makeSpeakerRow, makeJudgeRow, makeMotion } from './setup/cv-fixtures';

const scores = (pairs: [number, number | null][]) =>
  pairs.map(([roundNumber, score]) => ({ roundNumber, positionLabel: null, score }));

const teamRounds = (
  rows: [number, string | null, boolean | null, number | null][],
) =>
  rows.map(([roundNumber, position, won, points]) => ({
    roundNumber,
    position,
    won,
    points,
  }));

describe('computeSpeakerStats — score profile', () => {
  test('empty input yields an empty but well-formed payload', () => {
    const s = computeSpeakerStats({ speakerRows: [], judgeRows: [] });
    expect(s.scoreProfile.speeches).toBe(0);
    expect(s.scoreProfile.mean).toBeNull();
    expect(s.scoreProfile.bins).toEqual([]);
    expect(s.results.winRate).toBeNull();
    expect(s.quirks).toEqual([]);
    expect(s.volume.tournamentsSpoken).toBe(0);
  });

  test('summarises the score series with quantiles, spread and extremes', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 1n,
          tournamentName: 'Alpha Open',
          year: 2024,
          roundScores: scores([
            [1, 70],
            [2, 74],
            [3, 76],
            [4, 78],
            [5, 82],
          ]),
        }),
      ],
      judgeRows: [],
    });

    expect(s.scoreProfile.speeches).toBe(5);
    expect(s.scoreProfile.mean).toBeCloseTo(76);
    expect(s.scoreProfile.median).toBeCloseTo(76);
    expect(s.scoreProfile.min).toBe(70);
    expect(s.scoreProfile.max).toBe(82);
    expect(s.scoreProfile.q1).toBeCloseTo(74);
    expect(s.scoreProfile.q3).toBeCloseTo(78);
    expect(s.scoreProfile.iqr).toBeCloseTo(4);
    expect(s.scoreProfile.stdev).toBeCloseTo(4);
    expect(s.scoreProfile.best).toMatchObject({ score: 82, roundNumber: 5, tournamentName: 'Alpha Open' });
    expect(s.scoreProfile.worst).toMatchObject({ score: 70, roundNumber: 1 });
  });

  test('null score cells never reach the profile', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          roundScores: scores([
            [1, 75],
            [2, null],
            [3, 77],
          ]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.scoreProfile.speeches).toBe(2);
    expect(s.scoreProfile.mean).toBeCloseTo(76);
  });

  test('the best speech names its motion only when the round released exactly one', () => {
    const rows = [
      makeSpeakerRow({
        tournamentId: 1n,
        roundScores: scores([
          [1, 85],
          [2, 70],
        ]),
      }),
    ];
    const single = computeSpeakerStats({
      speakerRows: rows,
      judgeRows: [],
      taggedMotions: [makeMotion({ tournamentId: 1n, roundNumber: 1, text: 'THW ban X' })],
    });
    expect(single.scoreProfile.best?.motion).toBe('THW ban X');

    const ambiguous = computeSpeakerStats({
      speakerRows: rows,
      judgeRows: [],
      taggedMotions: [
        makeMotion({ tournamentId: 1n, roundNumber: 1, seq: 0, text: 'THW ban X' }),
        makeMotion({ tournamentId: 1n, roundNumber: 1, seq: 1, text: 'THW ban Y' }),
      ],
    });
    expect(ambiguous.scoreProfile.best?.motion).toBeNull();
  });
});

describe('buildBins', () => {
  test('uses whole-point bins for a normal speech-score spread', () => {
    const bins = buildBins([70, 71, 71, 72]);
    expect(bins).toEqual([
      { from: 70, to: 71, count: 1 },
      { from: 71, to: 72, count: 2 },
      { from: 72, to: 73, count: 1 },
    ]);
  });

  test('widens the bin when the spread would produce too many columns', () => {
    const wide = buildBins([10, 40, 70, 99]);
    expect(wide.length).toBeLessThanOrEqual(21);
    expect(wide.reduce((s, b) => s + b.count, 0)).toBe(4);
  });

  test('an empty series produces no bins', () => {
    expect(buildBins([])).toEqual([]);
  });
});

describe('computeSpeakerStats — field context', () => {
  const field: CvFieldStat[] = [
    {
      tournamentId: 1n,
      speakerCount: 200,
      fieldMeanAvg: 74,
      fieldStdevAvg: 2,
      fieldMedianAvg: 74,
      fieldP90Avg: 78,
      betterThanUser: 19,
    },
  ];

  test('derives delta, z-score, percentile and placement from the field summary', () => {
    const s = computeSpeakerStats({
      speakerRows: [makeSpeakerRow({ tournamentId: 1n, speakerAvgScore: '78.0' })],
      judgeRows: [],
      fieldStats: field,
    });

    const p = s.fieldContext.placements[0];
    expect(p.delta).toBeCloseTo(4);
    expect(p.z).toBeCloseTo(2);
    expect(p.placement).toBe(20);
    expect(p.percentile).toBeCloseTo(90.5);
    expect(s.fieldContext.speakersFaced).toBe(200);
    expect(s.fieldContext.bestPlacement?.tournamentId).toBe('1');
  });

  test('tournaments without a field summary are simply absent, not zeroed', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({ tournamentId: 1n, speakerAvgScore: '78.0' }),
        makeSpeakerRow({ tournamentId: 2n, speakerAvgScore: '80.0' }),
      ],
      judgeRows: [],
      fieldStats: field,
    });
    expect(s.fieldContext.placements).toHaveLength(1);
    expect(s.coverage.withFieldContext).toBe(1);
  });

  test('a zero-spread field yields no z-score rather than an infinity', () => {
    const s = computeSpeakerStats({
      speakerRows: [makeSpeakerRow({ tournamentId: 1n, speakerAvgScore: '78.0' })],
      judgeRows: [],
      fieldStats: [{ ...field[0], fieldStdevAvg: 0 }],
    });
    expect(s.fieldContext.placements[0].z).toBeNull();
  });
});

describe('computeSpeakerStats — round dynamics', () => {
  test('profiles each round number and reports opening/closing momentum', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 1n,
          roundScores: scores([
            [1, 70],
            [2, 71],
            [3, 72],
            [4, 76],
            [5, 77],
            [6, 78],
          ]),
        }),
      ],
      judgeRows: [],
    });

    expect(s.roundDynamics.profile).toHaveLength(6);
    expect(s.roundDynamics.openingAvg).toBeCloseTo(71);
    expect(s.roundDynamics.closingAvg).toBeCloseTo(77);
    expect(s.roundDynamics.momentum).toBeCloseTo(6);
    expect(s.roundDynamics.momentumSamples).toBe(1);
    expect(s.roundDynamics.slopePerRound).toBeGreaterThan(0);
    expect(s.roundDynamics.slopeSamples).toBe(1);
  });

  test('tournaments shorter than six scored rounds do not feed momentum', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          roundScores: scores([
            [1, 70],
            [2, 75],
            [3, 80],
          ]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.roundDynamics.openingAvg).toBeNull();
    expect(s.roundDynamics.momentum).toBeNull();
    expect(s.roundDynamics.momentumSamples).toBe(0);
    // A slope is still fitted — three points is enough for a line.
    expect(s.roundDynamics.slopeSamples).toBe(1);
  });

  test('best/worst round numbers ignore rounds with a single sample', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({ tournamentId: 1n, roundScores: scores([[1, 70], [2, 75]]) }),
        makeSpeakerRow({ tournamentId: 2n, roundScores: scores([[1, 72], [2, 77], [9, 95]]) }),
      ],
      judgeRows: [],
    });
    expect(s.roundDynamics.bestRoundNumber?.roundNumber).toBe(2);
    expect(s.roundDynamics.worstRoundNumber?.roundNumber).toBe(1);
  });
});

describe('computeSpeakerStats — results', () => {
  test('counts wins, points distribution and streaks in chronological order', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 1n,
          year: 2023,
          teamRoundResults: teamRounds([
            [1, 'OG', true, 3],
            [2, 'OO', true, 3],
            [3, 'CG', false, 0],
          ]),
        }),
        makeSpeakerRow({
          tournamentId: 2n,
          year: 2024,
          teamRoundResults: teamRounds([
            [1, 'CO', false, 1],
            [2, 'OG', false, 0],
            [3, 'OO', true, 2],
          ]),
        }),
      ],
      judgeRows: [],
    });

    expect(s.results.decidedRounds).toBe(6);
    expect(s.results.wins).toBe(3);
    expect(s.results.winRate).toBeCloseTo(0.5);
    expect(s.results.longestWinStreak).toBe(2);
    // 2023 R3 loss then 2024 R1 and R2 losses — the run spans tournaments.
    expect(s.results.longestLossStreak).toBe(3);
    expect(s.results.pointsDistribution).toEqual([
      { points: 3, rounds: 2 },
      { points: 2, rounds: 1 },
      { points: 1, rounds: 1 },
      { points: 0, rounds: 2 },
    ]);
    expect(s.results.avgPoints).toBeCloseTo(1.5);
  });

  test('rounds without a recorded outcome break no streaks and count as undecided', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          teamRoundResults: teamRounds([
            [1, 'OG', true, 3],
            [2, 'OO', null, null],
            [3, 'CG', true, 3],
          ]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.results.decidedRounds).toBe(2);
    expect(s.results.longestWinStreak).toBe(2);
  });

  test('break rate and championships come from the row flags', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({ tournamentId: 1n, broke: true, eliminationReached: 'Grand Final', wonTournament: true }),
        makeSpeakerRow({ tournamentId: 2n, broke: true, eliminationReached: 'Quarterfinals' }),
        makeSpeakerRow({ tournamentId: 3n }),
        makeSpeakerRow({ tournamentId: 4n }),
      ],
      judgeRows: [],
    });
    expect(s.results.breaks).toBe(2);
    expect(s.results.breakRate).toBeCloseTo(0.5);
    expect(s.results.championships).toBe(1);
    expect(s.results.finals).toBe(1);
    expect(s.results.deepestOutround).toBe('Grand Final');
  });
});

describe('computeSpeakerStats — splits', () => {
  const rows = [
    makeSpeakerRow({
      tournamentId: 1n,
      year: 2024,
      format: 'British Parliamentary',
      region: 'South Asia',
      totalTeams: 60,
      roundScores: scores([
        [1, 78],
        [2, 74],
      ]),
      teamRoundResults: teamRounds([
        [1, 'OG', true, 3],
        [2, 'Closing Opposition', false, 1],
      ]),
    }),
  ];

  test('seat splits canonicalise the position vocabulary and keep bench order', () => {
    const s = computeSpeakerStats({ speakerRows: rows, judgeRows: [] });
    expect(s.splits.byPosition.map((p) => p.key)).toEqual(['OG', 'CO']);
    const og = s.splits.byPosition[0];
    expect(og).toMatchObject({ rounds: 1, decidedRounds: 1, wins: 1, winRate: 1 });
    expect(og.avgScore).toBeCloseTo(78);
    // Career mean is 76, so OG sits two points above the user's baseline.
    expect(og.scoreDelta).toBeCloseTo(2);
    expect(og.winRateDelta).toBeCloseTo(50);
  });

  test('motion splits credit every motion released for a debated round', () => {
    const s = computeSpeakerStats({
      speakerRows: rows,
      judgeRows: [],
      taggedMotions: [
        makeMotion({ tournamentId: 1n, roundNumber: 1, motionType: 'THW', topic: 'Politics' }),
        makeMotion({ tournamentId: 1n, roundNumber: 2, seq: 1, motionType: 'THW', topic: null }),
        // A round the user never debated contributes nothing.
        makeMotion({ tournamentId: 1n, roundNumber: 7, seq: 2, motionType: 'THBT' }),
      ],
    });
    expect(s.splits.byMotionType.map((m) => m.key)).toEqual(['THW']);
    expect(s.splits.byMotionType[0].rounds).toBe(2);
    expect(s.splits.byMotionTopic).toHaveLength(1);
    expect(s.splits.byMotionTopic[0]).toMatchObject({ key: 'Politics', rounds: 1 });
  });

  test('field-size buckets sort small to large and skip unsized tournaments', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        ...rows,
        makeSpeakerRow({
          tournamentId: 2n,
          totalTeams: null,
          teamRoundResults: teamRounds([[1, 'OG', true, 3]]),
        }),
        makeSpeakerRow({
          tournamentId: 3n,
          totalTeams: 200,
          teamRoundResults: teamRounds([[1, 'OG', false, 0]]),
        }),
      ],
      judgeRows: [],
    });
    expect(s.splits.byFieldSize.map((b) => b.key)).toEqual(['48–99 teams', '100+ teams']);
  });

  test('region splits exclude untagged tournaments', () => {
    const s = computeSpeakerStats({
      speakerRows: [...rows, makeSpeakerRow({ tournamentId: 5n, region: null, teamRoundResults: teamRounds([[1, 'OG', true, 3]]) })],
      judgeRows: [],
    });
    expect(s.splits.byRegion.map((r) => r.key)).toEqual(['South Asia']);
  });
});

describe('computeSpeakerStats — partners and volume', () => {
  test('aggregates partners per tournament and counts distinct partnerships', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 1n,
          teammates: ['Ada'],
          broke: true,
          roundScores: scores([[1, 80]]),
          teamRoundResults: teamRounds([[1, 'OG', true, 3]]),
        }),
        makeSpeakerRow({
          tournamentId: 2n,
          teammates: ['Ada'],
          roundScores: scores([[1, 74]]),
          teamRoundResults: teamRounds([[1, 'OO', false, 1]]),
        }),
        makeSpeakerRow({ tournamentId: 3n, teammates: ['Grace'], roundScores: scores([[1, 77]]) }),
      ],
      judgeRows: [],
    });

    const ada = s.partners.find((p) => p.name === 'Ada')!;
    expect(ada.tournaments).toBe(2);
    expect(ada.breaks).toBe(1);
    expect(ada.avgScore).toBeCloseTo(77);
    expect(ada.winRate).toBeCloseTo(0.5);
    expect(s.volume.partners).toBe(2);
  });

  test('volume counts rounds from scores and results without double-counting', () => {
    const s = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          roundScores: scores([
            [1, 75],
            [2, 76],
          ]),
          teamRoundResults: teamRounds([
            [2, 'OG', true, 3],
            [3, 'OO', false, 0],
          ]),
        }),
      ],
      judgeRows: [makeJudgeRow({ year: 2025, inroundsChaired: 4 })],
    });
    expect(s.volume.roundsDebated).toBe(3);
    expect(s.volume.speechesScored).toBe(2);
    expect(s.volume.roundsChaired).toBe(4);
    expect(s.volume.tournamentsJudged).toBe(1);
  });
});

describe('deriveQuirks', () => {
  // Three long tournaments: the momentum quirk deliberately refuses to fire
  // on fewer, so the fixture has to clear that floor.
  const base = () =>
    computeSpeakerStats({
      speakerRows: [1n, 2n, 3n].map((tournamentId, i) =>
        makeSpeakerRow({
          tournamentId,
          year: 2022 + i,
          roundScores: scores([
            [1, 70],
            [2, 71],
            [3, 72],
            [4, 77],
            [5, 78],
            [6, 79],
          ]),
        }),
      ),
      judgeRows: [],
    });

  test('reports momentum with the sample it was fitted on', () => {
    const quirks = base().quirks;
    const momentum = quirks.find((q) => q.id === 'momentum');
    expect(momentum).toBeDefined();
    expect(momentum!.text).toContain('7.0');
    expect(momentum!.tone).toBe('pos');
    expect(momentum!.basis).toContain('3 tournaments');
  });

  test('momentum stays silent below three long tournaments', () => {
    const thin = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          roundScores: scores([
            [1, 70],
            [2, 71],
            [3, 72],
            [4, 77],
            [5, 78],
            [6, 79],
          ]),
        }),
      ],
      judgeRows: [],
    });
    expect(thin.roundDynamics.momentum).toBeCloseTo(7);
    expect(thin.quirks.find((q) => q.id === 'momentum')).toBeUndefined();
  });

  test('suppresses seat claims below the sample floor', () => {
    const stats = computeSpeakerStats({
      speakerRows: [
        makeSpeakerRow({
          teamRoundResults: teamRounds([
            [1, 'OG', true, 3],
            [2, 'CO', false, 0],
          ]),
        }),
      ],
      judgeRows: [],
    });
    expect(stats.quirks.find((q) => q.id === 'seat-spread')).toBeUndefined();
  });

  test('every quirk carries the number it claims and a basis', () => {
    const { quirks, ...rest } = base();
    void quirks;
    for (const q of deriveQuirks(rest)) {
      expect(q.basis.length).toBeGreaterThan(0);
      expect(/\d/.test(q.text)).toBe(true);
    }
  });
});
