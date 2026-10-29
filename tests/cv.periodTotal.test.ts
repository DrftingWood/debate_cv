/**
 * The Record page's year groups and subtotals (lib/cv/periodTotal.ts; owner
 * decisions 14-15, 2026-10-29).
 */
import { describe, expect, it } from 'vitest';
import { judgingYearTotal, openYears, recordYears, speakingYearTotal } from '@/lib/cv/periodTotal';
import { makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

describe('speakingYearTotal', () => {
  it('is null for a year with no speaking', () => {
    expect(speakingYearTotal([])).toBeNull();
  });

  it('counts breaks, picks the deepest result and takes the median team place', () => {
    const t = speakingYearTotal([
      makeSpeakerRow({
        broke: true,
        eliminationReached: 'Quarterfinals',
        teamRank: 4,
        totalTeams: 40,
      }),
      makeSpeakerRow({
        broke: true,
        eliminationReached: 'Semifinals',
        teamRank: 8,
        totalTeams: 40,
      }),
      makeSpeakerRow({ broke: false, teamRank: 30, totalTeams: 40 }),
    ]);
    expect(t).toMatchObject({
      tournaments: 3,
      broke: 2,
      bestResult: 'Semifinals',
      medianTeamPlace: { label: 'top 20%', n: 3 },
    });
  });

  it('leaves the best result empty when nothing broke', () => {
    expect(speakingYearTotal([makeSpeakerRow({ broke: false })])?.bestResult).toBeNull();
  });

  it('weights the speaker average by speeches, skipping rows without one', () => {
    const t = speakingYearTotal([
      makeSpeakerRow({ speakerAvgScore: '75.0', prelimsSpoken: 3 }),
      makeSpeakerRow({ speakerAvgScore: '79.0', prelimsSpoken: 1 }),
      makeSpeakerRow({ speakerAvgScore: null, prelimsSpoken: 5 }),
    ]);
    expect(t?.speakerAverage).toEqual({ value: 76, speeches: 4 });
  });

  it('has no median when no row has a usable team place', () => {
    expect(speakingYearTotal([makeSpeakerRow({ teamRank: null })])?.medianTeamPlace).toBeNull();
  });
});

describe('judgingYearTotal', () => {
  it('counts outrounds (the judging break), chaired outrounds and core roles', () => {
    expect(
      judgingYearTotal([
        makeJudgeRow({ broke: true, lastOutroundChaired: 'Semifinals' }),
        makeJudgeRow({ broke: true, judgeTypeTag: 'core' }),
        makeJudgeRow({ broke: false }),
      ]),
    ).toEqual({ tournaments: 3, outrounds: 2, chaired: 1, core: 1 });
  });
});

describe('recordYears and openYears', () => {
  it('lists every year in either role, newest first, undated last', () => {
    const years = recordYears(
      [makeSpeakerRow({ year: 2023 }), makeSpeakerRow({ year: null })],
      [makeJudgeRow({ year: 2025 })],
    );
    expect(years.map((y) => y.year)).toEqual([2025, 2023, null]);
    expect(years[0].speakingTotal).toBeNull();
    expect(years[0].judgingTotal?.tournaments).toBe(1);
  });

  it('opens the current and previous calendar year', () => {
    const years = recordYears(
      [2026, 2025, 2024].map((year) => makeSpeakerRow({ year })),
      [],
    );
    expect([...openYears(years, new Date('2026-10-29'))].sort()).toEqual([2025, 2026]);
  });

  it('opens the latest year when the record ends earlier, so nothing lands folded', () => {
    const years = recordYears([makeSpeakerRow({ year: 2021 }), makeSpeakerRow({ year: 2019 })], []);
    expect([...openYears(years, new Date('2026-10-29'))]).toEqual([2021]);
  });
});
