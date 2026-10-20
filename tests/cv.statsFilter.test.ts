import { describe, expect, test } from 'vitest';
import {
  EMPTY_FILTER,
  filterCvData,
  isFilterActive,
  parseStatsFilter,
  serializeStatsFilter,
  visibleQuirkIds,
  filterFacts,
} from '@/lib/cv/statsFilter';
import { buildStatsFacts } from '@/lib/cv/statsFacts';
import { makeSpeakerRow, makeJudgeRow } from './setup/cv-fixtures';

const scores = (...pairs: Array<[number, number]>) =>
  pairs.map(([roundNumber, score]) => ({ roundNumber, positionLabel: null, score }));
const rounds = (...rows: Array<[number, string]>) =>
  rows.map(([roundNumber, position]) => ({ roundNumber, position, won: true, points: 3 }));
const mate = (name: string, rs: ReturnType<typeof scores>) => ({ key: name, name, speakerScoreTotal: null, roundScores: rs });

// Three tournaments: a pro-am with Ann, peers with Bob, peers with Ann.
const data = {
  speakerRows: [
    makeSpeakerRow({
      tournamentId: 1n, format: 'British Parliamentary', prelimRoundCount: 2,
      roundScores: scores([1, 78], [2, 78]), teammates: ['Ann'],
      teammateDetails: [mate('Ann', scores([1, 75], [2, 75]))],
      teamRoundResults: rounds([1, 'OG'], [2, 'CG']),
    }),
    makeSpeakerRow({
      tournamentId: 2n, format: 'British Parliamentary', prelimRoundCount: 2,
      roundScores: scores([1, 77], [2, 77]), teammates: ['Bob'],
      teammateDetails: [mate('Bob', scores([1, 77], [2, 77]))],
      teamRoundResults: rounds([1, 'CG'], [2, 'CO']),
    }),
    makeSpeakerRow({
      tournamentId: 3n, format: 'Asian Parliamentary', prelimRoundCount: 2,
      roundScores: scores([1, 76], [2, 76]), teammates: ['Ann', 'Cy'],
      teammateDetails: [mate('Ann', scores([1, 76], [2, 76])), mate('Cy', scores([1, 76], [2, 76]))],
      teamRoundResults: rounds([1, 'Government'], [2, 'Opposition']),
    }),
  ],
  judgeRows: [makeJudgeRow({ tournamentId: 9n })],
  taggedMotions: [],
  fieldStats: [],
};
const facts = buildStatsFacts(data);

describe('parse / serialize', () => {
  test('round-trips every dimension through the query string', () => {
    const filter = { partners: ['Ann', 'Bob Lee'], pairings: ['pro' as const], seats: ['BP:CG', 'AP:Gov'] };
    const qs = serializeStatsFilter(filter);
    expect(parseStatsFilter(new URLSearchParams(qs))).toEqual(filter);
  });

  test('ignores unknown pairing values and blank entries', () => {
    expect(parseStatsFilter(new URLSearchParams('pairing=pro&pairing=best&partner=&seat=BP:OG'))).toEqual({
      partners: [],
      pairings: ['pro'],
      seats: ['BP:OG'],
    });
  });

  test('an empty filter serializes to nothing and is inactive', () => {
    expect(serializeStatsFilter(EMPTY_FILTER)).toBe('');
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, seats: ['BP:OG'] })).toBe(true);
  });
});

describe('filterCvData', () => {
  test('no filter returns the data untouched', () => {
    expect(filterCvData(data, facts, EMPTY_FILTER)).toBe(data);
  });

  test('partner filter keeps tournaments with any chosen partner', () => {
    const out = filterCvData(data, facts, { ...EMPTY_FILTER, partners: ['Ann'] });
    expect(out.speakerRows.map((r) => r.tournamentId)).toEqual([1n, 3n]);
  });

  test('pairing filter keeps tournaments with that label', () => {
    const out = filterCvData(data, facts, { ...EMPTY_FILTER, pairings: ['pro'] });
    expect(out.speakerRows.map((r) => r.tournamentId)).toEqual([1n]);
  });

  test('dimensions combine with AND, choices within one with OR', () => {
    const out = filterCvData(data, facts, { ...EMPTY_FILTER, partners: ['Ann', 'Bob'], pairings: ['peers'] });
    expect(out.speakerRows.map((r) => r.tournamentId)).toEqual([2n, 3n]);
  });

  test('seat filter keeps only the matching rounds, and drops tournaments with none', () => {
    const out = filterCvData(data, facts, { ...EMPTY_FILTER, seats: ['BP:CG'] });
    expect(out.speakerRows.map((r) => r.tournamentId)).toEqual([1n, 2n]);
    expect(out.speakerRows[0]!.roundScores.map((s) => s.roundNumber)).toEqual([2]);
    expect(out.speakerRows[0]!.teamRoundResults.map((s) => s.roundNumber)).toEqual([2]);
    expect(out.speakerRows[1]!.roundScores.map((s) => s.roundNumber)).toEqual([1]);
  });

  test('seat filter drops the tab average cell, which spans every round', () => {
    const withAverage = {
      ...data,
      speakerRows: [
        {
          ...data.speakerRows[0]!,
          roundScores: [...data.speakerRows[0]!.roundScores, { roundNumber: 0, positionLabel: 'average', score: 78 }],
        },
      ],
    };
    const out = filterCvData(withAverage, buildStatsFacts(withAverage), { ...EMPTY_FILTER, seats: ['BP:OG'] });
    expect(out.speakerRows[0]!.roundScores.map((s) => s.roundNumber)).toEqual([1]);
  });

  test('judging and motions are never filtered', () => {
    const out = filterCvData(data, facts, { ...EMPTY_FILTER, partners: ['Nobody'] });
    expect(out.speakerRows).toEqual([]);
    expect(out.judgeRows).toBe(data.judgeRows);
    expect(out.taggedMotions).toBe(data.taggedMotions);
  });
});

describe('findings under a seat filter', () => {
  test('findings about whole tournaments or round order are withheld; per-round ones stay', () => {
    expect(visibleQuirkIds(['momentum', 'consistency', 'field-percentile', 'seat-spread', 'motion-type',
      'topic-weakness', 'field-size', 'streak', 'break-rate'], { ...EMPTY_FILTER, seats: ['BP:OG'] }))
      // 'streak' counts consecutive rounds; with other seats' rounds removed,
      // "consecutive" skips the rounds in between.
      .toEqual(['consistency', 'topic-weakness']);
  });

  test('partner and pairing filters keep whole tournaments, so every finding stays', () => {
    const ids = ['momentum', 'field-percentile', 'break-rate'];
    expect(visibleQuirkIds(ids, { ...EMPTY_FILTER, partners: ['Ann'], pairings: ['pro'] })).toEqual(ids);
  });
});

describe('seat filter — outrounds', () => {
  // Tournament 1 sat CO only in an outround (round 3, past its 2 prelims).
  const withOutround = {
    ...data,
    speakerRows: [
      {
        ...data.speakerRows[0]!,
        teamRoundResults: [...data.speakerRows[0]!.teamRoundResults, { roundNumber: 3, position: 'CO', won: true, points: 3 }],
      },
      data.speakerRows[1]!,
    ],
  };
  const f = buildStatsFacts(withOutround);

  test('a seat held only in an outround does not keep the tournament', () => {
    const filter = { ...EMPTY_FILTER, seats: ['BP:CO'] };
    expect(filterCvData(withOutround, f, filter).speakerRows.map((r) => r.tournamentId)).toEqual([2n]);
    expect(filterFacts(f, filter).tournaments.map((t) => t.tournamentId)).toEqual(['2']);
    expect(filterFacts(f, filter).rounds.every((r) => !r.isOutround)).toBe(true);
  });
});

describe('findings superseded on the filterable page', () => {
  test('seat-spread and motion-type blend formats and rest on hidden tables, so they never show', () => {
    expect(visibleQuirkIds(['seat-spread', 'motion-type', 'consistency'], EMPTY_FILTER)).toEqual(['consistency']);
  });
});
