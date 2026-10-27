import { describe, expect, test } from 'vitest';
import {
  attachKnockoutResults,
  buildMotionEntries,
  judgedWithoutKnownRounds,
  knockoutResultFor,
  sameKnockoutStage,
} from '@/lib/cv/motionEntries';
import {
  pickHeaderMetrics,
  summarizeBreaks,
  breakRates,
  formatBreaks,
} from '@/lib/cv/headerMetrics';
import { makeSpeakerRow, makeJudgeRow, makeMotion } from './setup/cv-fixtures';

const scores = (pairs: [number, number | null][]) =>
  pairs.map(([roundNumber, score]) => ({ roundNumber, positionLabel: null, score }));

const teamRounds = (rows: [number, string | null, boolean | null, number | null][]) =>
  rows.map(([roundNumber, position, won, points]) => ({ roundNumber, position, won, points }));

describe('buildMotionEntries', () => {
  test('a BP outround that advanced is not a 2nd-or-better room', () => {
    const entries = buildMotionEntries(
      [
        makeSpeakerRow({
          tournamentId: 1n,
          prelimRoundCount: 5,
          roundScores: scores([[6, 75]]),
          teamRoundResults: teamRounds([[6, 'OG', true, null]]),
        }),
      ],
      [],
      [makeMotion({ tournamentId: 1n, roundNumber: 6, text: 'THW X' })],
    );
    expect(entries[0].won).toBeNull();
  });

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
      [
        makeJudgeRow({
          tournamentId: 7n,
          tournamentName: 'Cambridge IV',
          year: 2023,
          judgedRoundNumbers: [1],
        }),
      ],
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
    const outround = buildMotionEntries(
      rows,
      [],
      [makeMotion({ tournamentId: 1n, roundNumber: null, roundLabel: 'Grand Final', seq: 9 })],
    );
    expect(outround[0]).toMatchObject({ siblings: 0, score: null, won: null, debated: false });

    const undebated = buildMotionEntries(
      rows,
      [],
      [makeMotion({ tournamentId: 1n, roundNumber: 4 })],
    );
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

describe('buildMotionEntries: a judged tournament lists only the rounds the user sat on', () => {
  const judge = (over = {}) =>
    makeJudgeRow({ tournamentId: 7n, tournamentName: 'Cambridge IV', year: 2023, ...over });

  test('prelim motions: only the rounds with the user on the panel', () => {
    const entries = buildMotionEntries(
      [],
      [judge({ judgedRoundNumbers: [1, 3] })],
      [1, 2, 3, 4].map((n) =>
        makeMotion({ tournamentId: 7n, roundNumber: n, roundLabel: 'Round ' + n, text: 'R' + n }),
      ),
    );
    expect(entries.map((e) => e.motion.text)).toEqual(['R1', 'R3']);
  });

  test('outround motions: only the stages the user judged, in the same bracket', () => {
    const motions = [
      makeMotion({ tournamentId: 7n, roundNumber: null, roundLabel: 'Quarterfinals', text: 'QF' }),
      makeMotion({ tournamentId: 7n, roundNumber: null, roundLabel: 'Semifinals', text: 'SF' }),
      makeMotion({
        tournamentId: 7n,
        roundNumber: null,
        roundLabel: 'ESL Semifinals',
        text: 'ESL SF',
      }),
      makeMotion({ tournamentId: 7n, roundNumber: null, roundLabel: 'Grand Final', text: 'GF' }),
    ];
    const entries = buildMotionEntries(
      [],
      [judge({ judgedOutroundStages: ['Semifinals', 'Final'] })],
      motions,
    );
    // Open Semifinals and the Grand Final (a Final is a Grand Final); not the QF, not the ESL bracket.
    expect(entries.map((e) => e.motion.text).sort()).toEqual(['GF', 'SF']);
  });

  test('a judged tournament whose rounds are not recorded lists no motions rather than all of them', () => {
    const rows = [judge({ judgedRoundNumbers: [], judgedOutroundStages: [] })];
    const motions = [1, 2].map((n) =>
      makeMotion({ tournamentId: 7n, roundNumber: n, text: 'R' + n }),
    );
    expect(buildMotionEntries([], rows, motions)).toEqual([]);
    // ...and says so, so the page can tell the user instead of silently hiding the tournament.
    expect(judgedWithoutKnownRounds([], rows, motions)).toBe(1);
  });

  test('a tournament the user spoke at still lists every motion (its rounds are known from the draw)', () => {
    const entries = buildMotionEntries(
      [makeSpeakerRow({ tournamentId: 7n })],
      [judge({ judgedRoundNumbers: [1] })],
      [1, 2].map((n) => makeMotion({ tournamentId: 7n, roundNumber: n, text: 'R' + n })),
    );
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.judgedOnly === false)).toBe(true);
  });

  test('knowing the rounds means nothing is reported as unknown', () => {
    const rows = [judge({ judgedRoundNumbers: [2] })];
    const motions = [makeMotion({ tournamentId: 7n, roundNumber: 2, text: 'R2' })];
    expect(judgedWithoutKnownRounds([], rows, motions)).toBe(0);
  });
});

describe('pickHeaderMetrics', () => {
  const base = {
    totalTournaments: 0,
    breaks: { speaking: 0, judging: 0, tournamentsSpoken: 0, tournamentsJudged: 0 },
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
      breaks: { speaking: 3, judging: 0, tournamentsSpoken: 8, tournamentsJudged: 0 },
      bestSpeakerRank: { rank: 6, totalSpeakers: 90, topPercent: 6.7 },
      bestSpeakerAverage: 77.2,
    });
    const labels = tiles.map((t) => t.label);
    expect(labels).toContain('Breaks');
    expect(labels).not.toContain('Prelims chaired');
    expect(labels).not.toContain('Outrounds chaired');
    // The breaks tile carries its conversion rate rather than a bare count.
    // Owner rule C25/C26: a count per role, and a rate per role.
    expect(tiles.find((t) => t.label === 'Breaks')).toMatchObject({
      value: '3 speaking',
      hint: '38% of 8 spoken',
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
      breaks: { speaking: 2, judging: 0, tournamentsSpoken: 6, tournamentsJudged: 4 },
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
      bestSpeakerAverage: 71.4,
    });
    expect(tiles.map((t) => t.label)).toEqual(['Tournaments', 'Best speaker avg']);
  });

  test('never returns more tiles than the strip can lay out', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      totalTournaments: 20,
      speakerCount: 20,
      breaks: { speaking: 9, judging: 0, tournamentsSpoken: 20, tournamentsJudged: 0 },
      bestSpeakerRank: { rank: 3, totalSpeakers: 90, topPercent: 3.3 },
      bestSpeakerAverage: 78.1,
      totalRoundsChaired: 5,
      outroundsChaired: 2,
    });
    expect(tiles.length).toBeLessThanOrEqual(4);
  });
});

describe('speaking and judging breaks (C25, C26)', () => {
  const base = {
    totalTournaments: 20,
    totalRoundsChaired: 0,
    outroundsChaired: 0,
    bestSpeakerRank: null,
    bestSpeakerAverage: null,
    speakerCount: 12,
    judgeCount: 8,
    activeYears: null,
  };

  test('the header shows both numbers and a separate rate for each', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      breaks: { speaking: 6, judging: 2, tournamentsSpoken: 12, tournamentsJudged: 8 },
    });
    expect(tiles.find((t) => t.label === 'Breaks')).toMatchObject({
      value: '6 speaking, 2 judging',
      hint: '50% of 12 spoken · 25% of 8 judged',
    });
  });

  test('a judge-leaning record with judging breaks shows them', () => {
    const tiles = pickHeaderMetrics({
      ...base,
      speakerCount: 1,
      judgeCount: 9,
      totalRoundsChaired: 10,
      breaks: { speaking: 0, judging: 3, tournamentsSpoken: 1, tournamentsJudged: 9 },
    });
    expect(tiles.find((t) => t.label === 'Breaks')).toMatchObject({ value: '3 judging' });
  });

  test('summarizeBreaks never folds judged outrounds into the speaking count', () => {
    const row = (id: bigint, broke: boolean) => ({ tournamentId: id, broke });
    const s = summarizeBreaks(
      [row(1n, true), row(2n, false), row(1n, true)],
      [row(1n, true), row(3n, true), row(4n, false)],
    );
    expect(s).toEqual({ speaking: 1, judging: 2, tournamentsSpoken: 2, tournamentsJudged: 3 });
    expect(breakRates(s)).toEqual({ speaking: 0.5, judging: 2 / 3 });
  });

  test('no tournaments in a role means no rate and no number', () => {
    const s = summarizeBreaks([], []);
    expect(breakRates(s)).toEqual({ speaking: null, judging: null });
    expect(formatBreaks(s)).toBeNull();
  });
});

describe('knockout motions joined to the team result', () => {
  const ko = (tournamentId: bigint, stage: string, won: boolean) => ({ tournamentId, stage, won });
  const speaker = makeSpeakerRow({ tournamentId: 3n, tournamentName: 'Worlds', year: 2025 });
  const motions = [
    makeMotion({ tournamentId: 3n, roundNumber: 1, roundLabel: 'Round 1', seq: 0 }),
    makeMotion({ tournamentId: 3n, roundNumber: null, roundLabel: 'Quarterfinals', seq: 1 }),
    makeMotion({ tournamentId: 3n, roundNumber: null, roundLabel: 'Semifinals', seq: 2 }),
    makeMotion({ tournamentId: 3n, roundNumber: null, roundLabel: 'Grand Final', seq: 3 }),
    makeMotion({ tournamentId: 3n, roundNumber: null, roundLabel: 'ESL Final', seq: 4 }),
    makeMotion({ tournamentId: 3n, roundNumber: null, roundLabel: 'Novice Finals', seq: 5 }),
  ];
  const byLabel = (entries: ReturnType<typeof attachKnockoutResults>) =>
    Object.fromEntries(entries.map((e) => [e.motion.roundLabel, e]));

  test('advanced and eliminated stages carry the result and count as debated; others stay blank', () => {
    const out = byLabel(
      attachKnockoutResults(buildMotionEntries([speaker], [], motions), [
        ko(3n, 'Quarterfinals', true),
        ko(3n, 'Semifinals', false),
      ]),
    );
    expect(out['Quarterfinals']).toMatchObject({
      debated: true,
      knockout: { won: true, final: false },
      score: null,
    });
    expect(out['Semifinals']).toMatchObject({
      debated: true,
      knockout: { won: false, final: false },
    });
    expect(out['Grand Final']).toMatchObject({ debated: false, knockout: null });
    expect(out['Round 1'].knockout).toBeNull();
  });

  test('break categories are different stages: an Open final result never lands on the ESL or Novice final', () => {
    const out = byLabel(
      attachKnockoutResults(buildMotionEntries([speaker], [], motions), [ko(3n, 'Final', true)]),
    );
    // "Final" and "Grand Final" are the same last round of the open bracket.
    expect(out['Grand Final'].knockout).toEqual({ won: true, final: true });
    expect(out['ESL Final'].knockout).toBeNull();
    expect(out['Novice Finals'].knockout).toBeNull();
  });

  test('an ESL result joins the ESL motion only', () => {
    const out = byLabel(
      attachKnockoutResults(buildMotionEntries([speaker], [], motions), [
        ko(3n, 'ESL Grand Final', false),
      ]),
    );
    expect(out['ESL Final'].knockout).toEqual({ won: false, final: true });
    expect(out['Grand Final'].knockout).toBeNull();
  });

  test('a judged-only tournament never takes a team result', () => {
    const judge = makeJudgeRow({ tournamentId: 3n, judgedOutroundStages: ['Semifinals'] });
    const out = attachKnockoutResults(buildMotionEntries([], [judge], motions), [
      ko(3n, 'Semifinals', true),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ judgedOnly: true, knockout: null, debated: false });
  });

  test('several motions released for one knockout stage are siblings', () => {
    const entries = buildMotionEntries(
      [speaker],
      [],
      [
        makeMotion({ tournamentId: 3n, roundNumber: null, roundLabel: 'Grand Final', seq: 0 }),
        makeMotion({ tournamentId: 3n, roundNumber: null, roundLabel: 'Grand Final', seq: 1 }),
      ],
    );
    expect(entries.map((e) => e.siblings)).toEqual([1, 1]);
  });
});

describe('knockoutResultFor', () => {
  test('reads one stage across spellings, and gives null when same-stage rows disagree', () => {
    expect(
      knockoutResultFor('Finals', [
        { stage: 'Final', won: true },
        { stage: 'Grand Final', won: true },
      ]),
    ).toBe(true);
    const clash = [
      { stage: 'Final', won: true },
      { stage: 'Grand Final', won: false },
    ];
    expect(knockoutResultFor('Final', clash)).toBeNull();
    expect(knockoutResultFor('Semifinals', clash)).toBeNull();
  });

  test('a pre-round is its own stage, not the round it feeds', () => {
    expect(
      knockoutResultFor('Pre-Quarterfinals', [{ stage: 'Quarterfinals', won: true }]),
    ).toBeNull();
    expect(sameKnockoutStage('Pre-Quarterfinals', 'Partial Octofinals')).toBe(true);
  });
});
