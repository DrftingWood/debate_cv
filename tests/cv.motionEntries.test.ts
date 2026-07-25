import { describe, expect, test } from 'vitest';
import { buildMotionEntries } from '@/lib/cv/motionEntries';
import { pickHeaderMetrics } from '@/lib/cv/headerMetrics';
import { makeSpeakerRow, makeJudgeRow, makeMotion } from './setup/cv-fixtures';

const scores = (pairs: [number, number | null][]) =>
  pairs.map(([roundNumber, score]) => ({ roundNumber, positionLabel: null, score }));

const teamRounds = (rows: [number, string | null, boolean | null, number | null][]) =>
  rows.map(([roundNumber, position, won, points]) => ({ roundNumber, position, won, points }));

describe('buildMotionEntries', () => {
  test('joins a motion to the round the user debated it in', () => {
    const entries = buildMotionEntries(
      [
        makeSpeakerRow({
          tournamentId: 1n,
          tournamentName: 'Alpha Open',
          year: 2024,
          roundScores: scores([[1, 76.5]]),
          teamRoundResults: teamRounds([[1, 'OG', true, 3]]),
        }),
      ],
      [],
      [makeMotion({ tournamentId: 1n, roundNumber: 1, text: 'THW ban X' })],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tournamentName: 'Alpha Open',
      debated: true,
      judgedOnly: false,
      siblings: 0,
      score: 76.5,
      position: 'OG',
      won: true,
      points: 3,
    });
  });

  test('includes motions from a tournament the user only judged at', () => {
    // Regression: the first cut joined through speaker rows only, which
    // silently dropped every motion from a judged tournament.
    const entries = buildMotionEntries(
      [],
      [makeJudgeRow({ tournamentId: 7n, tournamentName: 'Cambridge IV', year: 2023 })],
      [makeMotion({ tournamentId: 7n, roundNumber: 1, text: 'THW judge X' })],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tournamentName: 'Cambridge IV',
      judgedOnly: true,
      debated: false,
      score: null,
      won: null,
    });
  });

  test('drops motions from tournaments that are not on the record at all', () => {
    const entries = buildMotionEntries(
      [makeSpeakerRow({ tournamentId: 1n })],
      [],
      [
        makeMotion({ tournamentId: 1n, roundNumber: 1 }),
        makeMotion({ tournamentId: 99n, roundNumber: 1 }),
      ],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].tournamentKey).toBe('1');
  });

  test('every motion in a multi-motion round gets the round data and a sibling count', () => {
    const entries = buildMotionEntries(
      [
        makeSpeakerRow({
          tournamentId: 1n,
          roundScores: scores([[3, 74]]),
          teamRoundResults: teamRounds([[3, 'CO', false, 1]]),
        }),
      ],
      [],
      [
        makeMotion({ tournamentId: 1n, roundNumber: 3, seq: 0, text: 'Motion A' }),
        makeMotion({ tournamentId: 1n, roundNumber: 3, seq: 1, text: 'Motion B' }),
      ],
    );

    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.siblings).toBe(1);
      expect(e.score).toBe(74);
      expect(e.won).toBe(false);
    }
  });

  test('a motion with no matching round is listed, but not marked debated', () => {
    // Two ways to have no round data: an outround (roundNumber null, so the
    // join short-circuits) and a prelim the user has no row for (the lookup
    // misses). Both must still appear on the archive.
    const rows = [makeSpeakerRow({ tournamentId: 1n, roundScores: scores([[1, 75]]) })];
    const outround = buildMotionEntries(rows, [], [
      makeMotion({ tournamentId: 1n, roundNumber: null, roundLabel: 'Grand Final', seq: 9 }),
    ]);
    expect(outround[0]).toMatchObject({ siblings: 0, score: null, won: null, debated: false });

    const undebated = buildMotionEntries(rows, [], [
      makeMotion({ tournamentId: 1n, roundNumber: 4 }),
    ]);
    expect(undebated[0]).toMatchObject({ score: null, debated: false });
  });

  test('sorts newest tournament first, then by name, then by document order', () => {
    const entries = buildMotionEntries(
      [
        makeSpeakerRow({ tournamentId: 1n, tournamentName: 'Bravo', year: 2022 }),
        makeSpeakerRow({ tournamentId: 2n, tournamentName: 'Alpha', year: 2024 }),
        makeSpeakerRow({ tournamentId: 3n, tournamentName: 'Charlie', year: null }),
      ],
      [],
      [
        makeMotion({ tournamentId: 1n, roundNumber: 1, seq: 0 }),
        makeMotion({ tournamentId: 3n, roundNumber: 1, seq: 0 }),
        makeMotion({ tournamentId: 2n, roundNumber: 2, seq: 1 }),
        makeMotion({ tournamentId: 2n, roundNumber: 1, seq: 0 }),
      ],
    );
    expect(entries.map((e) => `${e.tournamentName}:${e.motion.seq}`)).toEqual([
      'Alpha:0',
      'Alpha:1',
      'Bravo:0',
      // Undated sorts last.
      'Charlie:0',
    ]);
  });
});

describe('pickHeaderMetrics', () => {
  const base = {
    totalTournaments: 0,
    breaks: 0,
    totalRoundsChaired: 0,
    outroundsChaired: 0,
    bestSpeakerRank: null,
    bestSpeakerAverage: null,
    speakerCount: 0,
    judgeCount: 0,
    activeYears: null,
  };

  test('an empty record produces no tiles rather than a row of zeroes', () => {
    expect(pickHeaderMetrics(base)).toEqual([]);
  });

  test('a pure speaker is never shown a chairing tile', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      totalTournaments: 8,
      speakerCount: 8,
      breaks: 3,
      bestSpeakerRank: 6,
      bestSpeakerAverage: 77.2,
    });
    const labels = tiles.map((t) => t.label);
    expect(labels).toContain('Breaks');
    expect(labels).not.toContain('Prelims chaired');
    expect(labels).not.toContain('Outrounds chaired');
    // The breaks tile carries its conversion rate rather than a bare count.
    expect(tiles.find((t) => t.label === 'Breaks')).toMatchObject({
      value: 3,
      hint: '38% of entries',
    });
  });

  test('a pure judge is never shown a breaks tile', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      totalTournaments: 6,
      judgeCount: 6,
      totalRoundsChaired: 22,
      outroundsChaired: 3,
    });
    const labels = tiles.map((t) => t.label);
    expect(labels).toContain('Prelims chaired');
    expect(labels).toContain('Outrounds chaired');
    expect(labels).not.toContain('Breaks');
  });

  test('a mixed record shows both sides and annotates the split', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      totalTournaments: 10,
      speakerCount: 6,
      judgeCount: 4,
      breaks: 2,
      totalRoundsChaired: 12,
      outroundsChaired: 1,
    });
    expect(tiles[0]).toMatchObject({
      label: 'Tournaments',
      value: 10,
      hint: '6 speaking · 4 judging',
    });
    expect(tiles.map((t) => t.label)).toContain('Prelims chaired');
  });

  test('zero-valued tiles are dropped, never rendered as 0', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      totalTournaments: 4,
      speakerCount: 4,
      breaks: 0,
      bestSpeakerAverage: 71.4,
    });
    expect(tiles.map((t) => t.label)).toEqual(['Tournaments', 'Best speaker avg']);
  });

  test('never returns more tiles than the strip can lay out', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      totalTournaments: 20,
      speakerCount: 20,
      breaks: 9,
      bestSpeakerRank: 3,
      bestSpeakerAverage: 78.1,
      totalRoundsChaired: 5,
      outroundsChaired: 2,
    });
    expect(tiles.length).toBeLessThanOrEqual(4);
  });
});
