import { describe, expect, test } from 'vitest';
import { breakMargin, deriveOpenBreak, type CvOpenBreak } from '@/lib/cv/breakMargin';
import { makeSpeakerRow } from './setup/cv-fixtures';

const st = (teamName: string, points: number | null, wins: number | null = null) => ({ teamName, points, wins });

describe('deriveOpenBreak', () => {
  test('no Open break tab stored: nothing to derive', () => {
    expect(deriveOpenBreak([st('A', 12)], [], 'A')).toBeNull();
  });

  test('the line is the lowest breaking team, in both units', () => {
    const b = deriveOpenBreak(
      [st('A', 14, 5), st('B', 10, 4), st('C', 9, 4), st('D', 10, 3), st('E', 7, 2)],
      ['A', 'B', 'C'],
      'D',
    );
    expect(b).toEqual({ teams: 3, userOnBreak: false, linePoints: 9, lineWins: 4 });
  });

  test('a non-breaking team above the line (ineligible, capped) does not move it', () => {
    const b = deriveOpenBreak([st('A', 11), st('B', 9), st('X', 12)], ['A', 'B'], 'A');
    expect(b).toMatchObject({ linePoints: 9, userOnBreak: true });
  });

  test('a breaking team missing from the team tab leaves the line unknown, not optimistic', () => {
    const b = deriveOpenBreak([st('A', 11, 4), st('B', 9, 3)], ['A', 'B', 'Ghost'], 'A');
    expect(b).toMatchObject({ teams: 3, linePoints: null, lineWins: null });
  });

  test('a unit the tab did not publish is null for that unit only', () => {
    const b = deriveOpenBreak([st('A', null, 5), st('B', null, 4)], ['A', 'B'], 'A');
    expect(b).toMatchObject({ linePoints: null, lineWins: 4 });
  });

  test('duplicate names on the break list count once', () => {
    expect(deriveOpenBreak([st('A', 11)], ['A', 'A'], 'A')!.teams).toBe(1);
  });
});

const ob = (o: Partial<CvOpenBreak>): CvOpenBreak => ({
  teams: 16, userOnBreak: false, linePoints: 10, lineWins: 4, ...o,
});
let id = 0;
const row = (o: Parameters<typeof makeSpeakerRow>[0]) =>
  makeSpeakerRow({ tournamentId: BigInt(++id), tournamentName: `T${id}`, ...o });

describe('breakMargin', () => {
  test('empty input has nothing to show', () => {
    expect(breakMargin([])).toBeNull();
  });

  test('BP margins are in team points; two-team margins are in wins', () => {
    const m = breakMargin([
      row({ format: 'British Parliamentary', teamPoints: '14', teamWins: 99, openBreak: ob({ userOnBreak: true }) }),
      row({ format: 'Asian Parliamentary', teamPoints: '99', teamWins: 5, broke: true, openBreak: ob({ userOnBreak: true, lineWins: 4 }) }),
    ])!;
    const bp = m.formats.find((f) => f.format === 'British Parliamentary')!;
    const ap = m.formats.find((f) => f.format === 'Asian Parliamentary')!;
    expect(bp.unit).toBe('points');
    expect(bp.entries[0]).toMatchObject({ value: 14, line: 10, margin: 4, outcome: 'cleared' });
    expect(ap.unit).toBe('wins');
    expect(ap.entries[0]).toMatchObject({ value: 5, line: 4, margin: 1, outcome: 'cleared' });
  });

  test('formats are never pooled, even two that share a unit', () => {
    const m = breakMargin([
      row({ format: 'Asian Parliamentary', teamWins: 5, openBreak: ob({ userOnBreak: true }) }),
      row({ format: 'Australs', teamWins: 3, openBreak: ob({}) }),
    ])!;
    expect(m.formats.map((f) => [f.format, f.entries.length])).toEqual([
      ['Asian Parliamentary', 1],
      ['Australs', 1],
    ]);
  });

  test('outcomes: on the line, missed on speaks, missed by one, missed', () => {
    const m = breakMargin([
      row({ teamPoints: '10', openBreak: ob({ userOnBreak: true }) }),
      row({ teamPoints: '10', openBreak: ob({}) }),
      row({ teamPoints: '9', openBreak: ob({}) }),
      row({ teamPoints: '6', openBreak: ob({}) }),
    ])!;
    expect(m.formats[0].entries.map((e) => [e.margin, e.outcome])).toEqual([
      [0, 'on-the-line'],
      [0, 'missed-on-speaks'],
      [-1, 'missed-by-one'],
      [-4, 'missed'],
    ]);
    expect(m.formats[0]).toMatchObject({ tournaments: 4, cleared: 0, onTheLine: 1, missedOnSpeaks: 1, missedByOne: 1, missed: 1 });
  });

  test('median margin per format', () => {
    const m = breakMargin([
      row({ teamPoints: '13', openBreak: ob({ userOnBreak: true }) }),
      row({ teamPoints: '9', openBreak: ob({}) }),
      row({ teamPoints: '11', openBreak: ob({ userOnBreak: true }) }),
      row({ teamPoints: '6', openBreak: ob({}) }),
    ])!;
    // margins +3, −1, +1, −4 → sorted −4 −1 +1 +3 → median 0
    expect(m.formats[0].medianMargin).toBe(0);
  });

  test('a break in another category is kept, flagged, and still measured against the Open line', () => {
    const m = breakMargin([row({ teamPoints: '9', broke: true, teamBreakRank: 14, openBreak: ob({}) })])!;
    expect(m.formats[0].entries[0]).toMatchObject({ margin: -1, outcome: 'missed-by-one', brokeElsewhere: true });
  });

  test('exclusions carry a reason', () => {
    const m = breakMargin([
      row({ teamPoints: '12', openBreak: null }),
      row({ teamPoints: null, openBreak: ob({}) }),
      row({ teamPoints: '12', openBreak: ob({ linePoints: null }) }),
      // Above the line and not on the break: ineligible, capped or declined —
      // not a margin anyone can read.
      row({ teamPoints: '12', openBreak: ob({}) }),
      row({ format: null, teamPoints: '12', openBreak: ob({ userOnBreak: true }) }),
      row({ teamName: null, teamPoints: '12', openBreak: ob({ userOnBreak: true }) }),
      row({ teamPoints: '12', openBreak: ob({ userOnBreak: true }) }),
    ])!;
    expect(m.formats[0].entries).toHaveLength(1);
    expect(m.excluded.map((e) => e.reason)).toEqual([
      'no-open-break',
      'no-team-standing',
      'line-incomplete',
      'above-line-not-on-break',
      'unknown-format',
      'no-team-standing',
    ]);
    expect(m.excludedByReason).toMatchObject({
      'no-open-break': 1, 'no-team-standing': 2, 'line-incomplete': 1, 'above-line-not-on-break': 1, 'unknown-format': 1,
    });
  });

  test('everything excluded still returns the exclusions, with no formats', () => {
    const m = breakMargin([row({ openBreak: null })])!;
    expect(m.formats).toEqual([]);
    expect(m.excluded).toHaveLength(1);
  });

  test('half points are kept exactly', () => {
    const m = breakMargin([row({ teamPoints: '10.5', openBreak: ob({ userOnBreak: true }) })])!;
    expect(m.formats[0].entries[0].margin).toBe(0.5);
  });
});
