import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findIdentityIssues,
  parseTournamentDocuments,
  type IndexEntry,
  type TournamentReport,
  type UndecidedPair,
} from '@/lib/identity/affectedTournaments';
import {
  UNKNOWN_ROUNDS_HEADER,
  suggest,
  toUnknownRoundsCsv,
  tournamentNameOf,
  unknownRoundsRows,
  whyUnknown,
} from '@/lib/identity/unknownRounds';

// Synthetic pages in the tablesData shape the ingest parsers read. Names are
// invented.
function vuePage(tables: Array<{ title?: string; head: unknown[]; data: unknown[][] }>): string {
  return `<html><body><script>var x = ${JSON.stringify({ tablesData: tables })};</script></body></html>`;
}

// Tournament "u", with results pages for rounds 1 and 2:
//   Hal Ode    speaker on Hotel H (never on a results page), and a judge of
//              the same institution who sits on no panel     → both sides empty
//   Gus Tan    two judges, one spelling, Uni F and Uni G, once a round → same spelling
//   Kai Lo     judge in R1 (Uni K); speaker on Kilo K, no institution → no evidence
//   Ola Nwosu  scored on two teams in R1: an overlap, never on the sheet
const speakerTab = vuePage([
  {
    head: [
      { key: 'name' },
      { key: 'team' },
      { key: 'R1', title: 'R1' },
      { key: 'R2', title: 'R2' },
    ],
    data: [
      [{ text: 'Ola Nwosu' }, { text: 'Alpha A' }, { text: '75' }, { text: '76' }],
      [{ text: 'Ola Nwosu' }, { text: 'Beta B' }, { text: '74' }, { text: '' }],
    ],
  },
]);

const participants = vuePage([
  {
    title: 'Adjudicators',
    head: [{ key: 'name' }, { key: 'institution' }],
    data: [
      [{ text: 'Hal Ode' }, { text: 'Uni H' }],
      [{ text: 'Gus Tan' }, { text: 'Uni F' }],
      [{ text: 'Gus Tan' }, { text: 'Uni G' }],
      [{ text: 'Kai Lo' }, { text: 'Uni K' }],
    ],
  },
  {
    title: 'Speakers',
    head: [{ key: 'name' }, { key: 'team' }, { key: 'institution' }],
    data: [
      [{ text: 'Hal Ode' }, { text: 'Hotel H' }, { text: 'Uni H' }],
      [{ text: 'Kai Lo' }, { text: 'Kilo K' }, { text: '' }],
    ],
  },
]);

function resultsPage(rows: Array<[string, string]>): string {
  return vuePage([
    {
      head: [{ key: 'team' }, { key: 'result' }, { key: 'adjudicators' }],
      data: rows.map(([team, adjs]) => [{ text: team }, { text: 'won' }, { text: adjs }]),
    },
  ]);
}

const round1 = resultsPage([
  ['Alpha A', 'Gus Tan (c), Kai Lo'],
  ['Beta B', ''],
]);
const round2 = resultsPage([['Alpha A', 'Gus Tan (c)']]);

const landing = (slug: string, title: string) =>
  `<html><head><title>${title}</title></head><body><nav>${[1, 2]
    .map((n) => `<a href="/${slug}/results/round/${n}/">Round ${n}</a>`)
    .join('')}</nav></body></html>`;

// Tournament "v": two judges with one name and no results pages at all.
const noResultsParticipants = vuePage([
  {
    title: 'Adjudicators',
    head: [{ key: 'name' }, { key: 'institution' }],
    data: [
      [{ text: 'Sam Roy' }, { text: 'Uni P' }],
      [{ text: 'Sam Roy' }, { text: 'Uni Q' }],
    ],
  },
]);

const doc = (id: string, url = ''): IndexEntry => ({
  id,
  url,
  status: 200,
  fetchedAt: null,
  file: id,
});

const bodies: Record<string, string> = {
  s: speakerTab,
  p: participants,
  land: landing('u', 'Unity Open 2026 | Tabbycat'),
  r1: round1,
  r2: round2,
  vp: noResultsParticipants,
};
const read = (e: IndexEntry): string => bodies[e.id] ?? '';

const withResults: TournamentReport = {
  base: 'https://u.calicotab.com/u/',
  host: 'u.calicotab.com',
  slug: 'u',
  pagesRead: [],
  name: tournamentNameOf(doc('land', 'https://u.calicotab.com/u/'), read),
  findings: findIdentityIssues(
    parseTournamentDocuments({ speakerTab: doc('s'), participants: doc('p') }, read, {
      landing: doc('land', 'https://u.calicotab.com/u/'),
      results: [1, 2].map((n) => doc(`r${n}`, `https://u.calicotab.com/u/results/round/${n}/`)),
    }),
  ),
};

const withoutResults: TournamentReport = {
  base: 'https://v.calicotab.com/v/',
  host: 'v.calicotab.com',
  slug: 'v',
  pagesRead: [],
  findings: findIdentityIssues(parseTournamentDocuments({ participants: doc('vp') }, read)),
};

const col = (row: string[] | undefined, name: (typeof UNKNOWN_ROUNDS_HEADER)[number]) =>
  row?.[UNKNOWN_ROUNDS_HEADER.indexOf(name)];

describe('unknownRoundsRows', () => {
  const rows = unknownRoundsRows([withoutResults, withResults]);
  const byName = Object.fromEntries(rows.map((r) => [col(r, 'name_as_listed'), r]));

  test('one row per undecided group, in tournament order; decided groups are left out', () => {
    expect(rows.map((r) => `${col(r, 'tournament_url')} ${col(r, 'name_as_listed')}`)).toEqual([
      'https://u.calicotab.com/u/ Gus Tan',
      'https://u.calicotab.com/u/ Hal Ode',
      'https://u.calicotab.com/u/ Kai Lo',
      'https://v.calicotab.com/v/ Sam Roy',
    ]);
    expect(byName['Ola Nwosu']).toBeUndefined();
    expect(rows.every((r) => r.length === UNKNOWN_ROUNDS_HEADER.length)).toBe(true);
    expect(rows.every((r) => col(r, 'owner_verdict') === '')).toBe(true);
  });

  test('a speaker and a judge with no rounds anywhere, same institution: likely one person', () => {
    expect(byName['Hal Ode']).toEqual([
      'https://u.calicotab.com/u/',
      'Unity Open 2026',
      'Hal Ode',
      'judge',
      'speaker',
      '',
      'Hotel H',
      'Uni H',
      'Uni H',
      '',
      '',
      'judge_not_on_results: judge appears on no results page; speaker_no_rounds: no scored speaker rounds and team has no results page',
      'yes',
      'likely one person',
      '',
    ]);
  });

  test("two judges with one spelling: their rounds are the name's, and different institutions read as two", () => {
    const r = byName['Gus Tan'];
    expect(col(r, 'rounds_known_a')).toBe('R1,R2');
    expect(col(r, 'rounds_known_b')).toBe('R1,R2');
    expect(col(r, 'why_unknown')).toBe(
      'same_spelling_judges: same-spelled judges merged in results',
    );
    expect([col(r, 'institution_a'), col(r, 'institution_b')]).toEqual(['Uni F', 'Uni G']);
    expect(col(r, 'suggested')).toBe('likely two people');
  });

  test('a judge with known rounds and a speaker with none, one institution blank: no evidence', () => {
    const r = byName['Kai Lo'];
    expect([
      col(r, 'role_a'),
      col(r, 'rounds_known_a'),
      col(r, 'role_b'),
      col(r, 'rounds_known_b'),
    ]).toEqual(['judge', 'R1', 'speaker', '']);
    expect(col(r, 'why_unknown')).toBe(
      'speaker_no_rounds: no scored speaker rounds and team has no results page',
    );
    expect(col(r, 'suggested')).toBe('no evidence');
  });
});

describe('unknownRoundsRows: reasons and hints', () => {
  const rows = unknownRoundsRows([withoutResults, withResults]);
  const byName = Object.fromEntries(rows.map((r) => [col(r, 'name_as_listed'), r]));

  test('no results pages at all: one reason, and the flag says so', () => {
    const r = byName['Sam Roy'];
    expect(col(r, 'tournament_name')).toBe('');
    expect(col(r, 'why_unknown')).toBe(
      'no_results_pages: results pages missing for this tournament',
    );
    expect(col(r, 'team_results_pages_available')).toBe('no');
    expect(col(r, 'suggested')).toBe('likely two people');
  });
});

describe('toUnknownRoundsCsv', () => {
  test('CSV: header first, CRLF, cells quoted only when needed', () => {
    const rows = unknownRoundsRows([withoutResults, withResults]);
    const lines = toUnknownRoundsCsv(rows).split('\r\n');
    expect(lines[0]).toBe(UNKNOWN_ROUNDS_HEADER.join(','));
    expect(lines[1]).toBe(
      'https://u.calicotab.com/u/,Unity Open 2026,Gus Tan,judge,judge,,,Uni F,Uni G,"R1,R2","R1,R2",same_spelling_judges: same-spelled judges merged in results,yes,likely two people,',
    );
    expect(lines).toHaveLength(rows.length + 2);
    expect(lines.at(-1)).toBe('');
  });
});

describe('suggest and whyUnknown', () => {
  const side = (over: Partial<UndecidedPair['a']>): UndecidedPair['a'] => ({
    name: 'X Y',
    role: 'speaker',
    team: 'T',
    institution: 'Uni A',
    rounds: [],
    ...over,
  });
  const pair = (a: Partial<UndecidedPair['a']>, b: Partial<UndecidedPair['a']>): UndecidedPair => ({
    a: side(a),
    b: side(b),
    sameSpellingJudges: false,
  });

  test('same institution and disjoint known rounds: likely one; a shared round: no evidence', () => {
    expect(
      suggest(
        pair({ rounds: ['R1'] }, { role: 'adjudicator', rounds: ['R3'], institution: 'uni  a' }),
      ),
    ).toBe('likely one person');
    expect(suggest(pair({ rounds: ['R1'] }, { rounds: ['R1'] }))).toBe('no evidence');
  });

  test('different institution: likely two; a blank institution: no evidence', () => {
    expect(suggest(pair({}, { institution: 'Uni B' }))).toBe('likely two people');
    expect(suggest(pair({}, { institution: '' }))).toBe('no evidence');
  });

  test('a speaker row with no team, and a row with no role', () => {
    expect(whyUnknown(pair({ team: '' }, { role: 'other', rounds: [] }), 3)).toBe(
      'speaker_no_team: no scored speaker rounds and no team named; no_role: row has no speaker or judge role, so no rounds',
    );
  });
});

describe('the script writes the sheet next to the other outputs', () => {
  test('identity-unknown-rounds.csv in the --in folder, with its path and row count printed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identity-unknown-'));
    try {
      const docs: Array<[string, string, string]> = [
        ['1', 'https://u.calicotab.com/u/tab/speaker/', speakerTab],
        ['2', 'https://u.calicotab.com/u/participants/list/', participants],
        ['3', 'https://u.calicotab.com/u/', bodies.land ?? ''],
        ['4', 'https://u.calicotab.com/u/results/round/1/', round1],
        ['5', 'https://u.calicotab.com/u/results/round/2/', round2],
        ['6', 'https://v.calicotab.com/v/participants/list/', noResultsParticipants],
      ];
      const index = docs.map(([id, url, body]) => {
        writeFileSync(join(dir, `${id}.html.gz`), gzipSync(body));
        return JSON.stringify({
          id,
          url,
          status: 200,
          fetchedAt: '2026-10-01T00:00:00.000Z',
          file: `${id}.html.gz`,
        });
      });
      writeFileSync(join(dir, 'index.jsonl'), index.join('\n') + '\n');

      const stdout = execFileSync(
        process.execPath,
        ['scripts/find-identity-affected-tournaments.mjs', '--in', dir],
        {
          encoding: 'utf8',
        },
      );
      const sheet = join(dir, 'identity-unknown-rounds.csv');
      expect(stdout).toContain(`Rounds-unknown sheet: ${sheet}`);
      expect(stdout).toMatch(/ 4 rows, one per undecided group/);
      // The existing summary line agrees with the sheet's row count.
      expect(stdout).toMatch(/rounds unknown:\s+2 tournaments, 4 groups/);

      const text = readFileSync(sheet, 'utf8');
      expect(text.startsWith('﻿' + UNKNOWN_ROUNDS_HEADER.join(','))).toBe(true);
      const lines = text.split('\r\n').filter(Boolean);
      expect(lines).toHaveLength(5);
      expect(lines[2]).toMatch(
        /^https:\/\/u\.calicotab\.com\/u\/,Unity Open 2026,Hal Ode,judge,speaker,/,
      );
      expect(lines[4]).toMatch(
        /^https:\/\/v\.calicotab\.com\/v\/,,Sam Roy,judge,judge,,,Uni P,Uni Q,,,no_results_pages:/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
