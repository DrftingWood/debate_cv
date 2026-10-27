import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  affectedList,
  classifyDocumentUrl,
  exportUrlStats,
  findIdentityIssues,
  groupByTournament,
  isLostName,
  roundKey,
  parseTournamentDocuments,
  summarise,
  toCsv,
  type IndexEntry,
  type TournamentReport,
} from '@/lib/identity/affectedTournaments';

// Synthetic pages in the shape the ingest parsers read (window.vueData-style
// tablesData). Names are invented.
function vuePage(tables: Array<{ title?: string; head: unknown[]; data: unknown[][] }>): string {
  return `<html><body><div id="vue"></div><script>var x = ${JSON.stringify({ tablesData: tables })};</script></body></html>`;
}

const speakerTab = vuePage([
  {
    head: [{ key: 'Rk' }, { key: 'name' }, { key: 'team' }, { key: 'Total', title: 'Total' }],
    data: [
      [{ text: '1', sort: 1 }, { text: 'Rahul Sharma' }, { text: 'Alpha A' }, { text: '160' }],
      [{ text: '2', sort: 2 }, { text: 'Rahul  Sharma' }, { text: 'Beta B' }, { text: '158' }],
      [{ text: '3', sort: 3 }, { text: '李明' }, { text: 'Gamma C' }, { text: '150' }],
      [{ text: '4', sort: 4 }, { text: 'José Silva' }, { text: 'Gamma C' }, { text: '149' }],
      [{ text: '5', sort: 5 }, { text: 'Speaker 1' }, { text: 'Swing' }, { text: '140' }],
      [{ text: '6', sort: 6 }, { text: 'Speaker 1' }, { text: 'Swing 2' }, { text: '139' }],
      [{ text: '7', sort: 7 }, { text: 'Ann Lee' }, { text: 'Delta D' }, { text: '138' }],
    ],
  },
]);

const participants = vuePage([
  {
    title: 'Adjudicators',
    head: [{ key: 'name' }, { key: 'institution' }],
    data: [
      [{ text: 'Jos Silva' }, { text: 'Uni X' }],
      [{ text: '—' }, { text: 'Uni Y' }],
    ],
  },
  {
    title: 'Speakers',
    head: [{ key: 'name' }, { key: 'team' }],
    data: [
      [{ text: 'José Silva' }, { text: 'Gamma C' }],
      [{ text: 'Ann Lee' }, { text: 'Delta D' }],
    ],
  },
]);

const teamTab = vuePage([
  {
    head: [{ key: 'Rk' }, { key: 'team' }, { key: 'pts' }],
    data: [
      [
        { text: '1' },
        { text: 'Alpha A', popover: { content: [{ text: 'Rahul Sharma, Priya Das' }] } },
        { text: '9' },
      ],
      [
        { text: '2' },
        { text: 'Delta D', popover: { content: [{ text: 'Ann Lee, Bo Chan' }] } },
        { text: '6' },
      ],
    ],
  },
]);

// A person listed twice on the speaker tab with the same team (the rows
// differ only in rank: a duplicate, not a collision), and a speaker whose
// name is also on the adjudicator list, speaker row first. With no results
// pages there are no rounds to compare, so the second is 'unknown'.
const harmlessSpeakerTab = vuePage([
  {
    head: [{ key: 'Rk' }, { key: 'name' }, { key: 'team' }, { key: 'Total', title: 'Total' }],
    data: [
      [{ text: '1', sort: 1 }, { text: 'Kim Lee' }, { text: 'Echo E' }, { text: '160' }],
      [{ text: '2', sort: 2 }, { text: 'Kim Lee' }, { text: 'Echo E' }, { text: '160' }],
      [{ text: '3', sort: 3 }, { text: 'Mia Fox' }, { text: 'Foxtrot F' }, { text: '150' }],
    ],
  },
]);

const harmlessParticipants = vuePage([
  {
    title: 'Speakers',
    head: [{ key: 'name' }, { key: 'team' }],
    data: [[{ text: 'Mia Fox' }, { text: 'Foxtrot F' }]],
  },
  {
    title: 'Adjudicators',
    head: [{ key: 'name' }, { key: 'institution' }],
    data: [[{ text: 'Mia Fox' }, { text: 'Uni Z' }]],
  },
]);

// Two judges with one name and no results pages: 'unknown'.
const twoJudgesParticipants = vuePage([
  {
    title: 'Adjudicators',
    head: [{ key: 'name' }, { key: 'institution' }],
    data: [
      [{ text: 'Sam Roy' }, { text: 'Uni P' }],
      [{ text: 'Sam Roy' }, { text: 'Uni Q' }],
    ],
  },
]);

const cleanSpeakerTab = vuePage([
  {
    head: [{ key: 'Rk' }, { key: 'name' }, { key: 'team' }],
    data: [
      [{ text: '1' }, { text: 'Kim Park' }, { text: 'One' }],
      [{ text: '2' }, { text: 'Lee Park' }, { text: 'Two' }],
    ],
  },
]);

// ── Round fixtures: one tournament holding every class ──────────────────────
//
// Speaker tab with per-round scores (null = did not speak that round):
//   Ola Nwosu on Alpha A and on Beta B, both scored in R1     → overlap (speaker tab)
//   Pat Kim on Gamma C (R1, R2) and on Swing (R3 only)        → disjoint, same role
// Participants list, Adjudicators table first (as Tabbycat renders it):
//   Dee Rao judges R2 while Delta D (her team) debates R2     → overlap, speaker+judge
//   Eve Moss judges R3 only; Echo E debates R1-R2; same inst  → disjoint, speaker+judge,
//                                                               and the merge drops her judge role
//   Fay Ng twice: chair and panellist of round 1              → overlap, two judges
//   Gus Tan twice, one spelling, once per round               → unknown (can't tell)
//   Hal Ode's team Hotel H never appears on a results page,
//   and Hal Ode never judges one                              → unknown (no rounds either side)
const roundsSpeakerTab = vuePage([
  {
    head: [
      { key: 'Rk' },
      { key: 'name' },
      { key: 'team' },
      { key: 'R1', title: 'R1' },
      { key: 'R2', title: 'R2' },
      { key: 'R3', title: 'R3' },
      { key: 'Total', title: 'Total' },
    ],
    data: [
      [
        { text: '1' },
        { text: 'Ola Nwosu' },
        { text: 'Alpha A' },
        { text: '75' },
        { text: '76' },
        { text: '77' },
        { text: '228' },
      ],
      [
        { text: '2' },
        { text: 'Ola Nwosu' },
        { text: 'Beta B' },
        { text: '74' },
        { text: '' },
        { text: '' },
        { text: '74' },
      ],
      [
        { text: '3' },
        { text: 'Pat Kim' },
        { text: 'Gamma C' },
        { text: '73' },
        { text: '72' },
        { text: '' },
        { text: '145' },
      ],
      [
        { text: '4' },
        { text: 'Pat Kim' },
        { text: 'Swing' },
        { text: '' },
        { text: '' },
        { text: '71' },
        { text: '71' },
      ],
    ],
  },
]);

const roundsParticipants = vuePage([
  {
    title: 'Adjudicators',
    head: [{ key: 'name' }, { key: 'institution' }],
    data: [
      [{ text: 'Dee Rao' }, { text: 'Uni D' }],
      [{ text: 'Eve Moss' }, { text: 'Uni E' }],
      [{ text: 'Fay Ng' }, { text: 'Uni F' }],
      [{ text: 'Fay Ng' }, { text: 'Uni G' }],
      [{ text: 'Gus Tan' }, { text: 'Uni F' }],
      [{ text: 'Gus Tan' }, { text: 'Uni G' }],
      [{ text: 'Hal Ode' }, { text: 'Uni H' }],
    ],
  },
  {
    title: 'Speakers',
    head: [{ key: 'name' }, { key: 'team' }, { key: 'institution' }],
    data: [
      [{ text: 'Dee Rao' }, { text: 'Delta D' }, { text: 'Uni X' }],
      [{ text: 'Eve Moss' }, { text: 'Echo E' }, { text: 'Uni E' }],
      [{ text: 'Hal Ode' }, { text: 'Hotel H' }, { text: 'Uni H' }],
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
  ['Alpha A', 'Fay Ng (c), Fay Ng'],
  ['Beta B', 'Gus Tan'],
  ['Gamma C', ''],
  ['Delta D', ''],
  ['Echo E', ''],
]);
const round2 = resultsPage([
  ['Gamma C', 'Dee Rao (c), Gus Tan'],
  ['Delta D', ''],
  ['Echo E', ''],
]);
const round3 = resultsPage([
  ['Swing', 'Eve Moss (c), Gus Tan'],
  ['Alpha A', ''],
]);

const landing = (slug: string, labels: string[]) =>
  `<html><body><nav>${labels.map((l, i) => `<a href="/${slug}/results/round/${i + 1}/">${l}</a>`).join('')}</nav></body></html>`;

describe('classifyDocumentUrl', () => {
  test('tab pages, participants list and the two API lists', () => {
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/tab/team/')).toMatchObject({
      base: 'https://a.calicotab.com/open26/',
      kind: 'teamTab',
      slug: 'open26',
    });
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/tab/speaker-standings/')?.kind).toBe(
      'speakerTab',
    );
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/participants/list/')?.kind).toBe(
      'participants',
    );
    expect(
      classifyDocumentUrl('https://a.calicotab.com/api/v1/tournaments/open26/teams'),
    ).toMatchObject({ base: 'https://a.calicotab.com/open26/', kind: 'apiTeams' });
    expect(
      classifyDocumentUrl('https://a.calicotab.com/api/v1/tournaments/open26/adjudicators')?.kind,
    ).toBe('apiAdjudicators');
  });

  test('the landing page and round results are read for their rounds', () => {
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/')).toMatchObject({
      base: 'https://a.calicotab.com/open26/',
      kind: 'landing',
    });
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/results/round/4/')).toMatchObject({
      kind: 'roundResults',
      roundSeq: 4,
    });
    expect(
      classifyDocumentUrl('https://a.calicotab.com/open26/results/round/4/by-debate/'),
    ).toMatchObject({ kind: 'roundResults', roundSeq: 4 });
    expect(classifyDocumentUrl('https://wudc.calicotab.com/results/round/2/')).toMatchObject({
      base: 'https://wudc.calicotab.com/',
      slug: null,
      roundSeq: 2,
    });
  });

  test('a root-hosted tournament keys on the site root', () => {
    expect(classifyDocumentUrl('https://wudc.calicotab.com/tab/team/')).toMatchObject({
      base: 'https://wudc.calicotab.com/',
      slug: null,
    });
  });

  test('other pages and private URLs are not read', () => {
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/motions/')).toBeNull();
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/break/teams/open/')).toBeNull();
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/privateurls/abc/')).toBeNull();
    expect(
      classifyDocumentUrl('https://a.calicotab.com/api/v1/tournaments/open26/speakers/standings'),
    ).toBeNull();
    expect(classifyDocumentUrl('https://a.calicotab.com/api/')).toBeNull();
    expect(classifyDocumentUrl('not a url')).toBeNull();
  });
});

describe('groupByTournament', () => {
  const e = (id: string, url: string, fetchedAt: string, status = 200): IndexEntry => ({
    id,
    url,
    status,
    fetchedAt,
    file: `${id}.html.gz`,
  });

  test('keeps the newest 200 document of each kind, and the newest results page per round', () => {
    const [t, ...rest] = groupByTournament([
      e('old', 'https://a.calicotab.com/x/tab/team/', '2026-01-01T00:00:00Z'),
      e('new', 'https://a.calicotab.com/x/tab/team-standings/', '2026-02-01T00:00:00Z'),
      e('err', 'https://a.calicotab.com/x/tab/speaker/', '2026-03-01T00:00:00Z', 404),
      e('land', 'https://a.calicotab.com/x/', '2026-03-01T00:00:00Z'),
      e('r2', 'https://a.calicotab.com/x/results/round/2/', '2026-03-01T00:00:00Z'),
      e('r1old', 'https://a.calicotab.com/x/results/round/1/', '2026-01-01T00:00:00Z'),
      e('r1new', 'https://a.calicotab.com/x/results/round/1/by-team/', '2026-03-01T00:00:00Z'),
    ]);
    expect(rest).toEqual([]);
    expect(t!.docs.teamTab?.id).toBe('new');
    expect(t!.docs.speakerTab).toBeUndefined();
    expect(t!.landing?.id).toBe('land');
    expect(t!.results.map((r) => r.id)).toEqual(['r1new', 'r2']);
  });

  test('landing and results pages alone do not make a tournament', () => {
    expect(
      groupByTournament([
        e('land', 'https://b.calicotab.com/y/', '2026-03-01T00:00:00Z'),
        e('r1', 'https://b.calicotab.com/y/results/round/1/', '2026-03-01T00:00:00Z'),
      ]),
    ).toEqual([]);
  });
});

describe('roundKey', () => {
  test('a prelim is its number, whatever it is called; split halves are one round', () => {
    expect(roundKey('R3')).toBe('R3');
    expect(roundKey('Round 3')).toBe('R3');
    expect(roundKey('3')).toBe('R3');
    expect(roundKey('Ronda 3')).toBe('R3');
    expect(roundKey('R1A')).toBe('R1');
    expect(roundKey('Round 1B')).toBe('R1');
  });

  test('an outround is its stage and bracket; empty falls back to the sequence number', () => {
    expect(roundKey('Quarterfinals')).toBe(roundKey('Quarterfinal'));
    expect(roundKey('Novice Final')).not.toBe(roundKey('Grand Final'));
    expect(roundKey('', 4)).toBe('R4');
    expect(roundKey('Average')).toBeNull();
  });
});

describe('owner rules: Open and Novice finals, double panels', () => {
  const namesakes = (cols: [string, string]) =>
    findIdentityIssues(
      parseTournamentDocuments({ speakerTab: doc('s') }, () =>
        vuePage([
          {
            head: [
              { key: 'name' },
              { key: 'team' },
              { key: cols[0], title: cols[0] },
              { key: cols[1], title: cols[1] },
            ],
            data: [
              [{ text: 'Kay Obi' }, { text: 'Open Team' }, { text: '75' }, { text: '' }],
              [{ text: 'Kay Obi' }, { text: 'Novice Team' }, { text: '' }, { text: '74' }],
            ],
          },
        ]),
      ),
    ).sharedKeys[0];

  test('an Open final and a Novice final at one tournament are two people', () => {
    expect(namesakes(['Open Final', 'Novice Final'])).toMatchObject({
      class: 'overlap',
      evidence: expect.stringContaining('Open final and Novice final'),
    });
    expect(namesakes(['Grand Final', 'Novice Final'])).toMatchObject({ class: 'overlap' });
    expect(namesakes(['Novice Final', 'Final'])).toMatchObject({ class: 'overlap' });
  });

  test('other pairs of different outrounds stay disjoint (a semi in one, a final in the other)', () => {
    expect(namesakes(['Open Semifinal', 'Novice Final'])).toMatchObject({ class: 'disjoint' });
    expect(namesakes(['Open Final', 'Gold Final'])).toMatchObject({ class: 'disjoint' });
  });

  test('a team listed twice on one results page is a double-panel debate: no panel overlap', () => {
    const k = (rounds: string) =>
      findIdentityIssues(
        parseTournamentDocuments(
          { participants: doc('p') },
          (e) =>
            ({
              p: vuePage([
                {
                  title: 'Adjudicators',
                  head: [{ key: 'name' }, { key: 'institution' }],
                  data: [
                    [{ text: 'Lou Fey' }, { text: 'Uni A' }],
                    [{ text: 'Lou Fey' }, { text: 'Uni B' }],
                  ],
                },
              ]),
              r1: resultsPage([
                ['Red R', rounds],
                ['Red R', ''],
                ['Blue B', ''],
              ]),
            })[e.id]!,
          { results: [doc('r1', 'https://x.calicotab.com/x/results/round/1/')] },
        ),
      ).sharedKeys[0];
    expect(k('Lou Fey (c), Lou Fey')).toMatchObject({ class: 'unknown' });
  });

  test('without a repeated team the same two panel entries are an overlap', () => {
    const found = findIdentityIssues(
      parseTournamentDocuments(
        { participants: doc('p') },
        (e) =>
          ({
            p: vuePage([
              {
                title: 'Adjudicators',
                head: [{ key: 'name' }, { key: 'institution' }],
                data: [
                  [{ text: 'Lou Fey' }, { text: 'Uni A' }],
                  [{ text: 'Lou Fey' }, { text: 'Uni B' }],
                ],
              },
            ]),
            r1: resultsPage([
              ['Red R', 'Lou Fey (c), Lou Fey'],
              ['Blue B', ''],
            ]),
          })[e.id]!,
        { results: [doc('r1', 'https://x.calicotab.com/x/results/round/1/')] },
      ),
    ).sharedKeys[0];
    expect(found).toMatchObject({ class: 'overlap' });
  });
});

describe('isLostName', () => {
  test('letters that v1 deletes entirely', () => {
    expect(isLostName('李明')).toBe(true);
    expect(isLostName('Иван')).toBe(true);
    expect(isLostName('—')).toBe(false); // punctuation is not a person
    expect(isLostName('Иван Petrov')).toBe(false); // keeps "petrov"
  });
});

const doc = (id: string, url = ''): IndexEntry => ({
  id,
  url,
  status: 200,
  fetchedAt: null,
  file: id,
});

describe('findIdentityIssues without round data', () => {
  const lists = parseTournamentDocuments(
    { speakerTab: doc('s'), participants: doc('p'), teamTab: doc('t') },
    (entry) => ({ s: speakerTab, p: participants, t: teamTab })[entry.id]!,
  );
  const f = findIdentityIssues(lists);

  test('(a) a non-Latin name with an empty key, and not punctuation', () => {
    expect(f.emptyKeyNames).toEqual(['李明']);
  });

  test('(b) namesakes on the speaker tab, and an accent collision on the participants list', () => {
    const keys = Object.fromEntries(f.sharedKeys.map((s) => [s.key, s]));
    expect(Object.keys(keys).sort()).toEqual(['jos silva', 'rahul sharma']);
    expect(keys['rahul sharma']).toMatchObject({ entries: 2, sources: ['speaker tab'] });
    expect(keys['jos silva']!.names).toEqual(['Jos Silva', 'José Silva']);
    expect(keys['jos silva']!.sources).toEqual(['participants']);
  });

  test('with no per-round scores and no results pages, a shared key is unknown, never a collision', () => {
    const keys = Object.fromEntries(f.sharedKeys.map((s) => [s.key, s]));
    expect(keys['rahul sharma']).toMatchObject({
      class: 'unknown',
      crossRole: false,
      evidence: 'no rounds for the speaker and speaker',
    });
    // The Adjudicators table comes first, so participantByName keeps the
    // speaker row and the judge role is dropped either way.
    expect(keys['jos silva']).toMatchObject({
      class: 'unknown',
      crossRole: true,
      judgeRoleDropped: true,
      crossRoleInstitution: 'unknown',
    });
    expect(f.resultsPages).toBe(0);
  });

  test('stand-ins, and one person seen in several lists, are not namesakes', () => {
    expect(f.sharedKeys.map((s) => s.key)).not.toContain('speaker 1');
    expect(f.sharedKeys.map((s) => s.key)).not.toContain('ann lee');
  });
});

describe('shared-key classes', () => {
  const keysOf = (lists: Parameters<typeof findIdentityIssues>[0]) =>
    Object.fromEntries(findIdentityIssues(lists).sharedKeys.map((s) => [s.key, s]));

  const withRounds = keysOf(
    parseTournamentDocuments(
      { speakerTab: doc('s'), participants: doc('p') },
      (e) =>
        ({
          s: roundsSpeakerTab,
          p: roundsParticipants,
          land: landing('r', ['Round 1', 'Round 2', 'Round 3']),
          r1: round1,
          r2: round2,
          r3: round3,
        })[e.id]!,
      {
        landing: doc('land', 'https://r.calicotab.com/r/'),
        results: [1, 2, 3].map((n) =>
          doc(`r${n}`, `https://r.calicotab.com/r/results/round/${n}/`),
        ),
      },
    ),
  );

  test('two speakers scored in the same round are two people', () => {
    expect(withRounds['ola nwosu']).toMatchObject({
      class: 'overlap',
      crossRole: false,
      evidence: 'R1: speaker (speaker tab) and speaker (speaker tab)',
    });
  });

  test('one speaker on two teams in different rounds is plausibly one person (a swing)', () => {
    expect(withRounds['pat kim']).toMatchObject({
      class: 'disjoint',
      crossRole: false,
      evidence: 'speaker R1,R2 (speaker tab); speaker R3 (speaker tab)',
    });
  });

  test("a judge in the round her namesake's team debated is two people", () => {
    expect(withRounds['dee rao']).toMatchObject({
      class: 'overlap',
      crossRole: true,
      judgeRoleDropped: true,
      crossRoleInstitution: 'different',
      evidence: 'R2: speaker (team results) and judge (results)',
    });
  });

  test('a speaker who judged only other rounds is plausibly one person, whose judge role the merge drops', () => {
    expect(withRounds['eve moss']).toMatchObject({
      class: 'disjoint',
      crossRole: true,
      judgeRoleDropped: true,
      crossRoleInstitution: 'same',
      evidence: 'speaker R1,R2 (team results); judge R3 (results)',
    });
  });

  test('one name twice on one round as judge is two judges', () => {
    expect(withRounds['fay ng']).toMatchObject({
      class: 'overlap',
      crossRole: false,
      evidence: 'R1: two judges (results)',
    });
  });

  test('two judges with one spelling, seen once a round, cannot be told apart', () => {
    expect(withRounds['gus tan']).toMatchObject({ class: 'unknown', crossRole: false });
    expect(withRounds['gus tan']!.evidence).toMatch(/^judge R1-R3 \(results\): one spelling/);
  });

  test('a speaker whose team is on no results page has no rounds: unknown', () => {
    // Nor did his namesake judge any round on the stored pages.
    expect(withRounds['hal ode']).toMatchObject({
      class: 'unknown',
      crossRole: true,
      evidence: 'no rounds for the speaker and judge',
    });
  });

  test('the halves of a split round are one round', () => {
    const k = keysOf(
      parseTournamentDocuments(
        { speakerTab: doc('s'), participants: doc('p') },
        (e) =>
          ({
            s: vuePage([
              {
                head: [
                  { key: 'name' },
                  { key: 'team' },
                  { key: 'R1A', title: 'R1A' },
                  { key: 'R1B', title: 'R1B' },
                ],
                data: [[{ text: 'Ivy Ash' }, { text: 'India I' }, { text: '75' }, { text: '' }]],
              },
            ]),
            p: vuePage([
              { title: 'Adjudicators', head: [{ key: 'name' }], data: [[{ text: 'Ivy Ash' }]] },
              {
                title: 'Speakers',
                head: [{ key: 'name' }, { key: 'team' }],
                data: [[{ text: 'Ivy Ash' }, { text: 'India I' }]],
              },
            ]),
            land: landing('sp', ['Round 1A', 'Round 1B']),
            r1: resultsPage([['India I', '']]),
            r2: resultsPage([['Juliet J', 'Ivy Ash (c)']]),
          })[e.id]!,
        {
          landing: doc('land', 'https://sp.calicotab.com/sp/'),
          results: [1, 2].map((n) =>
            doc(`r${n}`, `https://sp.calicotab.com/sp/results/round/${n}/`),
          ),
        },
      ),
    );
    // She spoke in R1A (speaker tab) and judged R1B: the same round.
    expect(k['ivy ash']).toMatchObject({
      class: 'overlap',
      evidence: 'R1: speaker (speaker tab) and judge (results)',
    });
  });

  test('the same person twice with the same team is a duplicate row, not a namesake', () => {
    const k = keysOf(
      parseTournamentDocuments({ speakerTab: doc('s'), participants: doc('p') }, (e) =>
        e.id === 's' ? harmlessSpeakerTab : harmlessParticipants,
      ),
    );
    expect(k['kim lee']).toMatchObject({
      class: 'duplicate',
      entries: 2,
      sources: ['speaker tab'],
    });
    // Speaker listed before adjudicator: the judge row survives the merge.
    expect(k['mia fox']).toMatchObject({
      class: 'unknown',
      crossRole: true,
      judgeRoleDropped: false,
      sources: ['participants'],
    });
  });

  test('speaker+judge groups say whether the two rows share an institution', () => {
    const k = keysOf({
      participantRows: [
        {
          name: 'Ada Wu',
          role: 'adjudicator',
          judgeTag: 'normal',
          teamName: null,
          institution: 'Uni X',
        },
        {
          name: 'Ada Wu',
          role: 'speaker',
          judgeTag: null,
          teamName: 'Uni X A',
          institution: 'uni  x',
        },
        {
          name: 'Ben Ho',
          role: 'adjudicator',
          judgeTag: 'normal',
          teamName: null,
          institution: 'Uni X',
        },
        {
          name: 'Ben Ho',
          role: 'speaker',
          judgeTag: null,
          teamName: 'Uni Y A',
          institution: 'Uni Y',
        },
        {
          name: 'Cy Om',
          role: 'adjudicator',
          judgeTag: 'normal',
          teamName: null,
          institution: null,
        },
        {
          name: 'Cy Om',
          role: 'speaker',
          judgeTag: null,
          teamName: 'Uni Y B',
          institution: 'Uni Y',
        },
      ],
    });
    expect(k['ada wu']).toMatchObject({ crossRole: true, crossRoleInstitution: 'same' });
    expect(k['ben ho']).toMatchObject({ crossRole: true, crossRoleInstitution: 'different' });
    expect(k['cy om']).toMatchObject({ crossRole: true, crossRoleInstitution: 'unknown' });
  });

  test('two adjudicators with no results pages are unknown', () => {
    const k = keysOf(
      parseTournamentDocuments({ participants: doc('p') }, () => twoJudgesParticipants),
    );
    expect(k['sam roy']).toMatchObject({
      class: 'unknown',
      judgeRoleDropped: false,
      entries: 2,
      evidence: 'no rounds for either judge',
    });
  });

  test('a key keeps the strongest class any list showed', () => {
    const k = keysOf({
      speakerRows: parseTournamentDocuments({ speakerTab: doc('s') }, () => roundsSpeakerTab)
        .speakerRows,
      participantRows: [
        {
          name: 'Ola Nwosu',
          role: 'speaker',
          judgeTag: null,
          teamName: 'Alpha A',
          institution: null,
        },
        {
          name: 'Ola Nwosu',
          role: 'adjudicator',
          judgeTag: 'normal',
          teamName: null,
          institution: null,
        },
      ],
    });
    // Unknown on the participants list (no results pages), overlap on the speaker tab.
    expect(k['ola nwosu']).toMatchObject({
      class: 'overlap',
      crossRole: true,
      sources: ['speaker tab', 'participants'],
    });
  });
});

describe('API participants', () => {
  test('teams and adjudicators lists go through mapParticipants', () => {
    const teams = JSON.stringify([
      {
        url: 'u1',
        short_name: 'A',
        speakers: [
          { url: 's1', name: 'Mo Ali', anonymous: false },
          { url: 's2', name: 'Ана', anonymous: false },
        ],
      },
      { url: 'u2', short_name: 'B', speakers: [{ url: 's3', name: 'Mo Ali', anonymous: false }] },
    ]);
    const adjs = JSON.stringify([{ url: 'a1', name: 'Zed Kay', anonymous: false }]);
    const lists = parseTournamentDocuments(
      { apiTeams: doc('t'), apiAdjudicators: doc('a') },
      (e) => (e.id === 't' ? teams : adjs),
    );
    expect(lists.apiParticipantRows).toHaveLength(4);
    const f = findIdentityIssues(lists);
    expect(f.emptyKeyNames).toEqual(['Ана']);
    // Two speakers on two teams, no rounds. mapParticipants puts
    // adjudicators last, so this path never drops a judge role.
    expect(f.sharedKeys).toMatchObject([
      {
        key: 'mo ali',
        entries: 2,
        sources: ['api participants'],
        class: 'unknown',
        judgeRoleDropped: false,
      },
    ]);
  });
});

describe('output', () => {
  type Cls = 'overlap' | 'disjoint' | 'unknown' | 'duplicate';
  const report = (
    base: string,
    empty: string[],
    shared: Array<{
      cls: Cls;
      cross?: boolean;
      inst?: 'same' | 'different' | 'unknown';
      dropped?: boolean;
    }>,
  ): TournamentReport => ({
    base,
    host: 'h',
    slug: 's',
    pagesRead: ['speakerTab', 'results:3'],
    findings: {
      emptyKeyNames: empty,
      resultsPages: 3,
      sharedKeys: shared.map(({ cls, cross, inst, dropped }, i) => ({
        key: `k${i}`,
        names: [`K, ${i}`],
        entries: 2,
        sources: ['speaker tab'],
        class: cls,
        crossRole: cross ?? false,
        evidence: `ev${i}`,
        judgeRoleDropped: dropped ?? false,
        crossRoleInstitution: inst ?? null,
      })),
    },
  });
  const reports = [
    report('https://h/b/', [], []),
    report('https://h/a/', ['李明'], [{ cls: 'overlap' }]),
    report(
      'https://h/c/',
      [],
      [{ cls: 'overlap', cross: true, inst: 'same' }, { cls: 'duplicate' }],
    ),
    report(
      'https://h/d/',
      [],
      [{ cls: 'disjoint', cross: true, inst: 'different', dropped: true }, { cls: 'disjoint' }],
    ),
    report(
      'https://h/e/',
      [],
      [{ cls: 'unknown', cross: true, inst: 'unknown', dropped: true }, { cls: 'duplicate' }],
    ),
  ];

  test('CSV: affected first, then affected only if unknown counts; class counts; evidence follows the examples', () => {
    const lines = toCsv(reports).trim().split('\r\n');
    expect(lines[0]).toBe(
      'tournament_url,host,slug,affected,affected_if_unknown_counted,empty_key_names,shared_key_groups,shared_key_entries,overlap_groups,disjoint_speaker_judge_groups,disjoint_same_role_groups,unknown_round_groups,duplicate_groups,cross_role_same_institution,judge_role_dropped,judge_role_lost_one_person,results_pages,empty_key_examples,shared_key_examples,round_evidence,pages_read,error',
    );
    expect(lines[1]).toBe(
      'https://h/a/,h,s,true,true,1,1,2,1,0,0,0,0,0,0,0,3,李明,"K, 0 (x2, overlapping rounds, same role, speaker tab)",ev0,speakerTab results:3,',
    );
    expect(lines[2]).toBe(
      'https://h/c/,h,s,true,true,0,2,4,1,0,0,0,1,1,0,0,3,,"K, 0 (x2, overlapping rounds, speaker+judge, same institution, speaker tab) | K, 1 (x2, duplicate, speaker tab)",ev0 | ev1,speakerTab results:3,',
    );
    // Not affected, but affected if unknown groups count.
    expect(lines[3]).toBe(
      'https://h/e/,h,s,false,true,0,2,4,0,0,0,1,1,0,1,0,3,,"K, 0 (x2, rounds unknown, speaker+judge, unknown institution, speaker tab) | K, 1 (x2, duplicate, speaker tab)",ev0 | ev1,speakerTab results:3,',
    );
    expect(lines[4]).toBe(
      'https://h/b/,h,s,false,false,0,0,0,0,0,0,0,0,0,0,0,3,,,,speakerTab results:3,',
    );
    // Disjoint groups alone: plausibly one person each, not affected; the
    // dropped judge role on the speaker+judge one is lost credit.
    expect(lines[5]).toBe(
      'https://h/d/,h,s,false,false,0,2,4,0,1,1,0,0,0,1,1,3,,"K, 0 (x2, disjoint rounds, speaker+judge, different institution, speaker tab) | K, 1 (x2, disjoint rounds, same role, speaker tab)",ev0 | ev1,speakerTab results:3,',
    );
  });

  test('summary: the strict union, the upper bound, and the per-class tallies', () => {
    expect(summarise(reports)).toMatchObject({
      tournaments: 5,
      affected: 2,
      affectedIfUnknownCounted: 3,
      withEmptyKey: 1,
      withSharedKey: 4,
      sharedKeyGroups: 7,
      overlap: { tournaments: 2, groups: 2 },
      overlapSpeakerJudge: { tournaments: 1, groups: 1 },
      disjointSpeakerJudge: { tournaments: 1, groups: 1 },
      disjointSameRole: { tournaments: 1, groups: 1 },
      unknown: { tournaments: 1, groups: 1 },
      duplicate: { tournaments: 2, groups: 2 },
      crossRoleSameInstitution: { tournaments: 1, groups: 1 },
      judgeRoleDropped: { tournaments: 2, groups: 2 },
      judgeRoleLostByOnePerson: { tournaments: 1, groups: 1 },
      withoutResultsPages: 0,
    });
    expect(affectedList(reports)).toBe('https://h/a/\nhttps://h/c/');
  });
});

describe('exportUrlStats', () => {
  test('folds slug case and scheme, and spots a root-hosted tab whose API JSON sits on a second address', () => {
    const e = (id: string, url: string): IndexEntry => ({
      id,
      url,
      status: 200,
      fetchedAt: null,
      file: id,
    });
    const entries = [
      e('1', 'https://a.calicotab.com/Open26/tab/team/'),
      e('2', 'http://a.calicotab.com/open26/tab/speaker/'),
      e('3', 'https://a.calicotab.com/open26/tab/speaker/'),
      e('3b', 'https://a.calicotab.com/open26/tab/speaker/'),
      e('4', 'https://w.calicotab.com/tab/team/'),
      e('5', 'https://w.calicotab.com/api/v1/tournaments/wudc/teams'),
      e('6', 'https://a.calicotab.com/open26/'),
    ];
    expect(exportUrlStats(entries, groupByTournament(entries))).toEqual({
      documents: 7,
      distinctUrls: 6,
      tournamentUrls: 5,
      foldedUrls: 3,
      rootApiSplits: 1,
      hosts: 2,
    });
  });
});

describe('the script, end to end on a synthetic export', () => {
  test('reads index.jsonl + .html.gz offline, results pages included, and writes the CSV and list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identity-affected-'));
    try {
      const docs: Array<[string, string, string]> = [
        ['1', 'https://a.calicotab.com/open26/tab/speaker/', speakerTab],
        ['2', 'https://a.calicotab.com/open26/participants/list/', participants],
        ['3', 'https://b.calicotab.com/calm25/tab/speaker/', cleanSpeakerTab],
        ['4', 'https://b.calicotab.com/calm25/', '<html></html>'],
        ['5', 'https://c.calicotab.com/quiet24/tab/speaker/', harmlessSpeakerTab],
        ['6', 'https://c.calicotab.com/quiet24/participants/list/', harmlessParticipants],
        ['7', 'https://r.calicotab.com/r/tab/speaker/', roundsSpeakerTab],
        ['8', 'https://r.calicotab.com/r/participants/list/', roundsParticipants],
        ['9', 'https://r.calicotab.com/r/', landing('r', ['Round 1', 'Round 2', 'Round 3'])],
        ['10', 'https://r.calicotab.com/r/results/round/1/', round1],
        ['11', 'https://r.calicotab.com/r/results/round/2/', round2],
        ['12', 'https://r.calicotab.com/r/results/round/3/', round3],
      ];
      const index = docs.map(([id, url, body]) => {
        writeFileSync(join(dir, `${id}.html.gz`), gzipSync(body));
        return JSON.stringify({
          id,
          url,
          status: 200,
          contentHash: id,
          contentLength: body.length,
          fetchedAt: '2026-10-01T00:00:00.000Z',
          file: `${id}.html.gz`,
        });
      });
      writeFileSync(join(dir, 'index.jsonl'), index.join('\n') + '\n');

      const stdout = execFileSync(
        process.execPath,
        ['scripts/find-identity-affected-tournaments.mjs', '--in', dir],
        { encoding: 'utf8' },
      );
      expect(stdout).toMatch(/Tournament URLs with a tab page: 4 \(on 4 hosts\)/);
      // open26 has (a); r has overlaps. quiet24 has only an unknown group.
      expect(stdout).toMatch(/Affected \(a or overlapping rounds\): 2 of 4/);
      expect(stdout).toMatch(/Affected if unknown counted:\s+3 of 4/);
      expect(stdout).toMatch(/overlapping rounds:\s+1 tournaments, 3 groups/);
      expect(stdout).toMatch(/of which speaker\+judge:\s+1 tournaments, 1 groups/);
      expect(stdout).toMatch(/speaker and judge:\s+1 tournaments, 1 groups/);
      expect(stdout).toMatch(/same role:\s+1 tournaments, 1 groups/);
      expect(stdout).toMatch(/rounds unknown:\s+3 tournaments, 5 groups/);
      expect(stdout).toMatch(/duplicate rows:\s+1 tournaments, 1 groups/);
      expect(stdout).toMatch(
        /of which one plausible person \(disjoint speaker\+judge\): 1 tournaments, 1 groups/,
      );
      expect(stdout).toMatch(/Tournaments with no results page: 3/);

      const csv = readFileSync(join(dir, 'identity-affected-tournaments.csv'), 'utf8').split(
        '\r\n',
      );
      expect(csv[1]).toMatch(
        /^https:\/\/a\.calicotab\.com\/open26\/,a\.calicotab\.com,open26,true,true,1,2,4,0,0,0,2,0,/,
      );
      expect(csv[2]).toMatch(
        /^https:\/\/r\.calicotab\.com\/r\/,r\.calicotab\.com,r,true,true,0,7,14,3,1,1,2,0,2,3,1,3,/,
      );
      expect(csv[2]).toContain('R1: speaker (speaker tab) and speaker (speaker tab)');
      expect(csv[2]).toMatch(/participants speakerTab landing results:3,$/);
      expect(csv[3]).toMatch(
        /^https:\/\/c\.calicotab\.com\/quiet24\/,c\.calicotab\.com,quiet24,false,true,0,2,4,0,0,0,1,1,/,
      );
      expect(csv[4]).toMatch(
        /^https:\/\/b\.calicotab\.com\/calm25\/,b\.calicotab\.com,calm25,false,false,0,0,0,/,
      );
      expect(readFileSync(join(dir, 'identity-affected-tournaments.txt'), 'utf8')).toBe(
        'https://a.calicotab.com/open26/\nhttps://r.calicotab.com/r/\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
