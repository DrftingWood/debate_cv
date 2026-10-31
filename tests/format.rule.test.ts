import { describe, expect, it } from 'vitest';
import {
  decideTournamentFormat,
  inferTournamentFormat,
  type FormatInput,
} from '@/lib/calicotab/format';

// R9 fix round 1: decideTournamentFormat reports which numbered rule decided,
// and inferTournamentFormat (what ingest calls at scrape time) is unchanged:
// it is that same decision's format, whatever the rule.

const rooms = (seats: Array<string | null>) => [
  { teamResults: seats.map((position) => ({ position })) },
];
const team = (n: number) => Array.from({ length: 6 }, () => ({ speakers: Array(n).fill('s') }));
const base = (over: Partial<FormatInput>): FormatInput => ({
  tournamentName: 'Open',
  teamRows: [],
  speakerRows: [],
  registrationSpeakers: [],
  rounds: [],
  ...over,
});

const CASES: Array<[string, FormatInput, string | null, number | null]> = [
  ['four seats', base({ rounds: rooms(['OG', 'OO', 'CG', 'CO']) }), 'British Parliamentary', 1],
  ['named format', base({ tournamentName: 'Spring WSDC' }), 'World Schools', 2],
  ['policy name', base({ tournamentName: 'Policy Cup' }), 'Policy', 2],
  [
    'two-team shape',
    base({ teamRows: team(3), rounds: rooms(['Government', 'Opposition']) }),
    'Asian Parliamentary',
    3,
  ],
  ['BP championship name', base({ tournamentName: 'WUDC 2026' }), 'British Parliamentary', 4],
  ['team size only (2)', base({ teamRows: team(2) }), 'British Parliamentary', 5],
  ['team size only (3)', base({ teamRows: team(3) }), 'Asian Parliamentary', 5],
  ['nothing', base({}), null, null],
];

describe('decideTournamentFormat', () => {
  it.each(CASES)('%s', (_n, input, format, rule) => {
    expect(decideTournamentFormat(input)).toEqual({ format, rule });
  });
});

describe('inferTournamentFormat is unchanged for ingest', () => {
  it.each(CASES)('%s', (_n, input, format) => {
    expect(inferTournamentFormat(input)).toBe(format);
  });
});
