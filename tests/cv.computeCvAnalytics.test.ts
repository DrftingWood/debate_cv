import { describe, expect, test } from 'vitest';
import { computeCvAnalytics } from '@/lib/cv/computeCvAnalytics';
import { makeSpeakerRow, makeJudgeRow } from './setup/cv-fixtures';

describe('computeCvAnalytics', () => {
  test('returns empty aggregates for an empty CV', () => {
    const a = computeCvAnalytics({ speakerRows: [], judgeRows: [] });
    expect(a.speakerYearTrend).toEqual([]);
    expect(a.formatSlices).toEqual([]);
    expect(a.roundProfile).toEqual([]);
    expect(a.judgingYearTrend).toEqual([]);
    expect(a.coverage.speakerTournaments).toBe(0);
  });

  test('groups speaker rows by year with break rate and mean of averages', () => {
    const rows = [
      makeSpeakerRow({ tournamentId: 1n, year: 2024, speakerAvgScore: '76.0', broke: true, speakerRankOpen: 12 }),
      makeSpeakerRow({ tournamentId: 2n, year: 2024, speakerAvgScore: '78.0', broke: false, speakerRankOpen: 30 }),
      makeSpeakerRow({ tournamentId: 3n, year: 2025, speakerAvgScore: null, broke: true }),
    ];
    const a = computeCvAnalytics({ speakerRows: rows, judgeRows: [] });

    expect(a.speakerYearTrend).toHaveLength(2);
    const y2024 = a.speakerYearTrend[0];
    expect(y2024.year).toBe(2024);
    expect(y2024.tournaments).toBe(2);
    expect(y2024.avgSpeakerScore).toBeCloseTo(77.0);
    expect(y2024.breaks).toBe(1);
    expect(y2024.breakRate).toBeCloseTo(0.5);
    expect(y2024.bestSpeakerRank).toBe(12);

    // 2025 has no parsed average — the year still appears, average is null.
    const y2025 = a.speakerYearTrend[1];
    expect(y2025.avgSpeakerScore).toBeNull();
    expect(y2025.breakRate).toBe(1);
  });

  test('rows without a year are excluded from the trend but counted in coverage', () => {
    const rows = [
      makeSpeakerRow({ tournamentId: 1n, year: null }),
      makeSpeakerRow({ tournamentId: 2n, year: 2025 }),
    ];
    const a = computeCvAnalytics({ speakerRows: rows, judgeRows: [] });
    expect(a.speakerYearTrend).toHaveLength(1);
    expect(a.coverage.speakerTournaments).toBe(2);
    expect(a.coverage.speakerWithYear).toBe(1);
  });

  test('slices by format, mapping null format to Unknown and sorting by size', () => {
    const rows = [
      makeSpeakerRow({ tournamentId: 1n, format: 'British Parliamentary', broke: true }),
      makeSpeakerRow({ tournamentId: 2n, format: 'British Parliamentary' }),
      makeSpeakerRow({ tournamentId: 3n, format: null }),
    ];
    const a = computeCvAnalytics({ speakerRows: rows, judgeRows: [] });
    expect(a.formatSlices.map((s) => s.format)).toEqual(['British Parliamentary', 'Unknown']);
    expect(a.formatSlices[0].tournaments).toBe(2);
    expect(a.formatSlices[0].breakRate).toBeCloseTo(0.5);
  });

  test('round profile averages scores per round number across tournaments', () => {
    const rows = [
      makeSpeakerRow({
        tournamentId: 1n,
        roundScores: [
          { roundNumber: 1, positionLabel: null, score: 74 },
          { roundNumber: 2, positionLabel: null, score: 78 },
        ],
      }),
      makeSpeakerRow({
        tournamentId: 2n,
        roundScores: [
          { roundNumber: 1, positionLabel: null, score: 76 },
          { roundNumber: 2, positionLabel: null, score: null }, // missing cell drops out
        ],
      }),
    ];
    const a = computeCvAnalytics({ speakerRows: rows, judgeRows: [] });
    expect(a.roundProfile).toEqual([
      { roundNumber: 1, samples: 2, avgScore: 75 },
      { roundNumber: 2, samples: 1, avgScore: 78 },
    ]);
  });

  test('judging trend sums chaired inrounds and counts outround tournaments per year', () => {
    const rows = [
      makeJudgeRow({ tournamentId: 1n, year: 2025, inroundsChaired: 4, lastOutroundJudged: 'Semifinals' }),
      makeJudgeRow({ tournamentId: 2n, year: 2025, inroundsChaired: 2, lastOutroundJudged: null }),
      makeJudgeRow({ tournamentId: 3n, year: 2023, inroundsChaired: null }),
    ];
    const a = computeCvAnalytics({ speakerRows: [], judgeRows: rows });
    expect(a.judgingYearTrend).toEqual([
      { year: 2023, tournaments: 1, inroundsChaired: 0, outroundTournaments: 0 },
      { year: 2025, tournaments: 2, inroundsChaired: 6, outroundTournaments: 1 },
    ]);
  });

  test('non-numeric speakerAvgScore strings are ignored, not NaN-poisoned', () => {
    const rows = [
      makeSpeakerRow({ tournamentId: 1n, year: 2025, speakerAvgScore: 'n/a' }),
      makeSpeakerRow({ tournamentId: 2n, year: 2025, speakerAvgScore: '80.0' }),
    ];
    const a = computeCvAnalytics({ speakerRows: rows, judgeRows: [] });
    expect(a.speakerYearTrend[0].avgSpeakerScore).toBeCloseTo(80.0);
    expect(a.coverage.speakerWithAvgScore).toBe(1);
  });
});
