import { describe, expect, test } from 'vitest';
import {
  categoryCounts,
  categoryOfLabel,
  readCvCategory,
  rowForCategory,
  rowsForCategory,
} from '@/lib/cv/categoryFilter';
import { speakingSeries } from '@/lib/cv/careerChart';

// Owner, 2026-10-31: five categories on the speaking chart only: Open (with
// Gold / Silver / Bronze), ESL, EFL, Novice / Pro-Am, and Others.

const row = (over: Record<string, unknown> = {}) =>
  ({
    tournamentName: 'T',
    year: 2024,
    broke: true,
    eliminationReached: null,
    eliminationReachedByCategory: null,
    wonTournament: null,
    speakerRankOpen: null,
    speakerRankEsl: null,
    speakerRankEfl: null,
    ...over,
  }) as Parameters<typeof rowForCategory>[0];

describe('categoryOfLabel', () => {
  test.each([
    ['Grand Final', 'open'],
    ['Open Semifinals', 'open'],
    ['Gold Final', 'open'],
    ['Silver Quarterfinals', 'open'],
    ['Bronze Final', 'open'],
    ['ESL Grand Final', 'esl'],
    ['EFL Semifinals', 'efl'],
    ['Novice Final', 'novice'],
    ['Pro-Am Final', 'novice'],
    ['Senior Grand Final', 'other'],
    ['Varsity Quarterfinals', 'other'],
  ])('%s is %s', (label, cat) => expect(categoryOfLabel(label)).toBe(cat));

  test('a plate or consolation bracket is in no category', () => {
    expect(categoryOfLabel('Plate Final')).toBeNull();
    expect(categoryOfLabel('Consolation Semifinals')).toBeNull();
  });

  test('the query value is read, and anything else is no filter', () => {
    expect(readCvCategory('esl')).toBe('esl');
    expect(readCvCategory(['novice', 'esl'])).toBe('novice');
    expect(readCvCategory('bogus')).toBeNull();
    expect(readCvCategory(undefined)).toBeNull();
  });
});

describe('rowForCategory', () => {
  const both = row({
    eliminationReached: 'Quarterfinals',
    eliminationReachedByCategory: [{ category: 'ESL', stage: 'ESL Final' }],
    wonTournament: true,
    speakerRankEsl: 3,
  });

  test('Open keeps its own depth; the ESL win is not an Open title', () => {
    const open = rowForCategory(both, 'open')!;
    expect(open.eliminationReached).toBe('Quarterfinals');
    expect(open.eliminationReachedByCategory).toBeNull();
    expect(open.wonTournament).toBe(false);
    expect(open.speakerRankEsl).toBeNull();
  });

  test('ESL keeps the ESL final and its title and rank', () => {
    const esl = rowForCategory(both, 'esl')!;
    expect(esl.eliminationReached).toBeNull();
    expect(esl.wonTournament).toBe(true);
    expect(esl.speakerRankEsl).toBe(3);
  });

  test('a category with nothing in the tournament drops it; Open keeps a team that did not break', () => {
    expect(rowForCategory(both, 'novice')).toBeNull();
    expect(rowForCategory(row({ broke: false }), 'open')?.broke).toBe(false);
    expect(rowForCategory(row({ broke: false }), 'esl')).toBeNull();
  });

  test('a break of unknown depth stays an Open break', () => {
    expect(rowForCategory(row({ broke: true }), 'open')?.broke).toBe(true);
  });
});

describe('through the chart', () => {
  const rows = [
    row({
      tournamentName: 'A',
      eliminationReached: 'Grand Final',
      wonTournament: true,
    }),
    row({
      tournamentName: 'B',
      broke: true,
      eliminationReached: 'ESL Grand Final',
      wonTournament: true,
    }),
  ];

  test('each category shows its own champion cells', () => {
    const cells = (cat: Parameters<typeof rowsForCategory>[1]) =>
      speakingSeries(rowsForCategory(rows, cat)).years.flatMap((y) => y.cells);
    expect(cells(null)).toHaveLength(2);
    expect(cells('open').map((c) => [c.tournamentName, c.tier])).toEqual(
      expect.arrayContaining([['A', 'champion']]),
    );
    expect(cells('esl').map((c) => [c.tournamentName, c.tier, c.detail])).toEqual([
      ['B', 'champion', 'ESL Champion'],
    ]);
  });

  test('counts say which categories exist', () => {
    const c = categoryCounts(rows);
    expect(c.esl).toBe(1);
    expect(c.novice).toBe(0);
  });
});
