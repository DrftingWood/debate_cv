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
      [{ text: '1' }, { text: 'Alpha A', popover: { content: [{ text: 'Rahul Sharma, Priya Das' }] } }, { text: '9' }],
      [{ text: '2' }, { text: 'Delta D', popover: { content: [{ text: 'Ann Lee, Bo Chan' }] } }, { text: '6' }],
    ],
  },
]);

// A person listed twice on the speaker tab with the same team (the rows
// differ only in rank: a duplicate, not a collision), and a speaker whose
// name is also on the adjudicator list, speaker row first. Nobody both
// speaks and judges at one tournament, so the second is two people.
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

// Two different judges with one name: the real collision the participants
// list can show.
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

describe('classifyDocumentUrl', () => {
  test('tab pages, participants list and the two API lists', () => {
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/tab/team/')).toMatchObject({ base: 'https://a.calicotab.com/open26/', kind: 'teamTab', slug: 'open26' });
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/tab/speaker-standings/')?.kind).toBe('speakerTab');
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/participants/list/')?.kind).toBe('participants');
    expect(classifyDocumentUrl('https://a.calicotab.com/api/v1/tournaments/open26/teams')).toMatchObject({ base: 'https://a.calicotab.com/open26/', kind: 'apiTeams' });
    expect(classifyDocumentUrl('https://a.calicotab.com/api/v1/tournaments/open26/adjudicators')?.kind).toBe('apiAdjudicators');
  });

  test('a root-hosted tournament keys on the site root', () => {
    expect(classifyDocumentUrl('https://wudc.calicotab.com/tab/team/')).toMatchObject({ base: 'https://wudc.calicotab.com/', slug: null });
  });

  test('other pages and private URLs are not read', () => {
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/')).toBeNull();
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/results/round/1/')).toBeNull();
    expect(classifyDocumentUrl('https://a.calicotab.com/open26/privateurls/abc/')).toBeNull();
    expect(classifyDocumentUrl('https://a.calicotab.com/api/v1/tournaments/open26/speakers/standings')).toBeNull();
    expect(classifyDocumentUrl('not a url')).toBeNull();
  });
});

describe('groupByTournament', () => {
  test('keeps the newest 200 document of each kind', () => {
    const e = (id: string, url: string, fetchedAt: string, status = 200): IndexEntry => ({ id, url, status, fetchedAt, file: `${id}.html.gz` });
    const [t, ...rest] = groupByTournament([
      e('old', 'https://a.calicotab.com/x/tab/team/', '2026-01-01T00:00:00Z'),
      e('new', 'https://a.calicotab.com/x/tab/team-standings/', '2026-02-01T00:00:00Z'),
      e('err', 'https://a.calicotab.com/x/tab/speaker/', '2026-03-01T00:00:00Z', 404),
      e('land', 'https://a.calicotab.com/x/', '2026-03-01T00:00:00Z'),
    ]);
    expect(rest).toEqual([]);
    expect(t!.docs.teamTab?.id).toBe('new');
    expect(t!.docs.speakerTab).toBeUndefined();
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

describe('findIdentityIssues', () => {
  const lists = parseTournamentDocuments(
    {
      speakerTab: { id: 's', url: '', status: 200, fetchedAt: null, file: 's' },
      participants: { id: 'p', url: '', status: 200, fetchedAt: null, file: 'p' },
      teamTab: { id: 't', url: '', status: 200, fetchedAt: null, file: 't' },
    },
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

  test('(b) classes: two teams is a same-role collision; a speaker and an adjudicator is a cross-role collision', () => {
    const keys = Object.fromEntries(f.sharedKeys.map((s) => [s.key, s]));
    expect(keys['rahul sharma']).toMatchObject({ class: 'sameRole', judgeRoleDropped: false, crossRoleInstitution: null });
    // A speaker and a judge at one tournament are two people. ingest merges
    // them into one participant; the Adjudicators table comes first, so
    // participantByName keeps the speaker row and the judge loses theirs.
    // The speaker row names no institution, so the match is unknown.
    expect(keys['jos silva']).toMatchObject({ class: 'crossRole', judgeRoleDropped: true, crossRoleInstitution: 'unknown' });
  });

  test('stand-ins, and one person seen in several lists, are not namesakes', () => {
    // "Speaker 1" twice, and "Ann Lee" on the speaker tab, the participants
    // list and a team roster: neither is reported.
    expect(f.sharedKeys.map((s) => s.key)).not.toContain('speaker 1');
    expect(f.sharedKeys.map((s) => s.key)).not.toContain('ann lee');
  });
});

describe('shared-key classes', () => {
  const doc = (id: string) => ({ id, url: '', status: 200, fetchedAt: null, file: id });
  const keysOf = (lists: Parameters<typeof findIdentityIssues>[0]) =>
    Object.fromEntries(findIdentityIssues(lists).sharedKeys.map((s) => [s.key, s]));
  const keys = keysOf(
    parseTournamentDocuments({ speakerTab: doc('s'), participants: doc('p') }, (e) =>
      e.id === 's' ? harmlessSpeakerTab : harmlessParticipants,
    ),
  );

  test('the same person twice with the same team is a duplicate row, not a namesake', () => {
    expect(keys['kim lee']).toMatchObject({ class: 'duplicate', entries: 2, sources: ['speaker tab'] });
  });

  test('speaker listed before adjudicator: still a cross-role collision, though the judge row survives the merge', () => {
    expect(keys['mia fox']).toMatchObject({ class: 'crossRole', judgeRoleDropped: false, sources: ['participants'] });
  });

  test('cross-role groups say whether speaker and judge share an institution', () => {
    const k = keysOf({
      participantRows: [
        { name: 'Ada Wu', role: 'adjudicator', judgeTag: 'normal', teamName: null, institution: 'Uni X' },
        { name: 'Ada Wu', role: 'speaker', judgeTag: null, teamName: 'Uni X A', institution: 'uni  x' },
        { name: 'Ben Ho', role: 'adjudicator', judgeTag: 'normal', teamName: null, institution: 'Uni X' },
        { name: 'Ben Ho', role: 'speaker', judgeTag: null, teamName: 'Uni Y A', institution: 'Uni Y' },
        { name: 'Cy Om', role: 'adjudicator', judgeTag: 'normal', teamName: null, institution: null },
        { name: 'Cy Om', role: 'speaker', judgeTag: null, teamName: 'Uni Y B', institution: 'Uni Y' },
      ],
    });
    expect(k['ada wu']).toMatchObject({ class: 'crossRole', crossRoleInstitution: 'same' });
    expect(k['ben ho']).toMatchObject({ class: 'crossRole', crossRoleInstitution: 'different' });
    expect(k['cy om']).toMatchObject({ class: 'crossRole', crossRoleInstitution: 'unknown' });
  });

  test('two adjudicators from different institutions are a real collision', () => {
    const k = keysOf(parseTournamentDocuments({ participants: doc('p') }, () => twoJudgesParticipants));
    expect(k['sam roy']).toMatchObject({ class: 'sameRole', judgeRoleDropped: false, entries: 2 });
  });

  test('a key keeps the strongest class any list showed', () => {
    const k = keysOf({
      speakerRows: parseTournamentDocuments({ speakerTab: doc('s') }, () => speakerTab).speakerRows,
      participantRows: [
        { name: 'Rahul Sharma', role: 'speaker', judgeTag: null, teamName: 'Alpha A', institution: null },
        { name: 'Rahul Sharma', role: 'adjudicator', judgeTag: 'normal', teamName: null, institution: null },
      ],
    });
    expect(k['rahul sharma']).toMatchObject({ class: 'sameRole', sources: ['speaker tab', 'participants'], judgeRoleDropped: false });
  });
});

describe('API participants', () => {
  test('teams and adjudicators lists go through mapParticipants', () => {
    const teams = JSON.stringify([
      { url: 'u1', short_name: 'A', speakers: [{ url: 's1', name: 'Mo Ali', anonymous: false }, { url: 's2', name: 'Ана', anonymous: false }] },
      { url: 'u2', short_name: 'B', speakers: [{ url: 's3', name: 'Mo Ali', anonymous: false }] },
    ]);
    const adjs = JSON.stringify([{ url: 'a1', name: 'Zed Kay', anonymous: false }]);
    const lists = parseTournamentDocuments(
      {
        apiTeams: { id: 't', url: '', status: 200, fetchedAt: null, file: 't' },
        apiAdjudicators: { id: 'a', url: '', status: 200, fetchedAt: null, file: 'a' },
      },
      (e) => (e.id === 't' ? teams : adjs),
    );
    expect(lists.apiParticipantRows).toHaveLength(4);
    const f = findIdentityIssues(lists);
    expect(f.emptyKeyNames).toEqual(['Ана']);
    // Two speakers on two teams. mapParticipants puts adjudicators last, so
    // this path never drops a judge role.
    expect(f.sharedKeys).toMatchObject([
      { key: 'mo ali', entries: 2, sources: ['api participants'], class: 'sameRole', judgeRoleDropped: false },
    ]);
  });
});

describe('output', () => {
  type Cls = 'sameRole' | 'crossRole' | 'duplicate';
  type Inst = 'same' | 'different' | 'unknown';
  const report = (base: string, empty: string[], shared: Array<[Cls, Inst?, boolean?]>): TournamentReport => ({
    base,
    host: 'h',
    slug: 's',
    pagesRead: ['speakerTab'],
    findings: {
      emptyKeyNames: empty,
      sharedKeys: shared.map(([cls, inst, dropped], i) => ({
        key: `k${i}`,
        names: [`K, ${i}`],
        entries: 2,
        sources: ['speaker tab'],
        class: cls,
        judgeRoleDropped: dropped ?? false,
        crossRoleInstitution: inst ?? null,
      })),
    },
  });
  const reports = [
    report('https://h/b/', [], []),
    report('https://h/a/', ['李明'], [['sameRole']]),
    report('https://h/c/', [], [['crossRole', 'same'], ['duplicate']]),
    report('https://h/d/', [], [['duplicate'], ['sameRole']]),
    report('https://h/e/', [], [['duplicate']]),
    // The judge namesake lost their row to the speaker: the same collision.
    report('https://h/f/', [], [['crossRole', 'different', true]]),
  ];

  test('CSV: affected first, class counts, institution split, quoted cells', () => {
    const lines = toCsv(reports).trim().split('\r\n');
    expect(lines[0]).toBe(
      'tournament_url,host,slug,affected,empty_key_names,shared_key_groups,shared_key_entries,same_role_groups,cross_role_groups,cross_role_same_institution,cross_role_different_institution,cross_role_unknown_institution,duplicate_groups,judge_role_dropped,empty_key_examples,shared_key_examples,pages_read,error',
    );
    expect(lines[1]).toBe('https://h/a/,h,s,true,1,1,2,1,0,0,0,0,0,0,李明,"K, 0 (x2, same-role, speaker tab)",speakerTab,');
    // A cross-role group alone makes a tournament affected; its example names the institution match.
    expect(lines[2]).toBe(
      'https://h/c/,h,s,true,0,2,4,0,1,1,0,0,1,0,,"K, 0 (x2, cross-role, same institution, speaker tab) | K, 1 (x2, duplicate, speaker tab)",speakerTab,',
    );
    // Real collisions lead the examples.
    expect(lines[3]).toBe(
      'https://h/d/,h,s,true,0,2,4,1,0,0,0,0,1,0,,"K, 1 (x2, same-role, speaker tab) | K, 0 (x2, duplicate, speaker tab)",speakerTab,',
    );
    expect(lines[4]).toBe(
      'https://h/f/,h,s,true,0,1,2,0,1,0,1,0,0,1,,"K, 0 (x2, cross-role, different institution, speaker tab)",speakerTab,',
    );
    expect(lines[5]).toBe('https://h/b/,h,s,false,0,0,0,0,0,0,0,0,0,0,,,speakerTab,');
    // Duplicate rows alone do not make a tournament affected.
    expect(lines[6]).toBe('https://h/e/,h,s,false,0,1,2,0,0,0,0,0,1,0,,"K, 0 (x2, duplicate, speaker tab)",speakerTab,');
  });

  test('summary: per-class counts overlap, the affected union counts each tournament once', () => {
    expect(summarise(reports)).toMatchObject({
      tournaments: 6,
      // (a) 1 + same-role 2 + cross-role 2 = 5 class hits, but h/a has both
      // (a) and same-role: 4 tournaments.
      affected: 4,
      withCollision: 4,
      withEmptyKey: 1,
      withSharedKey: 5,
      emptyKeyNames: 1,
      sharedKeyGroups: 7,
      sameRole: { tournaments: 2, groups: 2 },
      crossRole: { tournaments: 2, groups: 2 },
      crossRoleSameInstitution: { tournaments: 1, groups: 1 },
      crossRoleDifferentInstitution: { tournaments: 1, groups: 1 },
      crossRoleUnknownInstitution: { tournaments: 0, groups: 0 },
      duplicate: { tournaments: 3, groups: 3 },
      judgeRoleDropped: { tournaments: 1, groups: 1 },
    });
    expect(affectedList(reports)).toBe('https://h/a/\nhttps://h/c/\nhttps://h/d/\nhttps://h/f/');
  });
});

describe('exportUrlStats', () => {
  test('folds slug case and scheme, and spots a root-hosted tab whose API JSON sits on a second address', () => {
    const e = (id: string, url: string): IndexEntry => ({ id, url, status: 200, fetchedAt: null, file: id });
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
  test('reads index.jsonl + .html.gz offline and writes the CSV and list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identity-affected-'));
    try {
      const docs: Array<[string, string, string]> = [
        ['1', 'https://a.calicotab.com/open26/tab/speaker/', speakerTab],
        ['2', 'https://a.calicotab.com/open26/participants/list/', participants],
        ['3', 'https://b.calicotab.com/calm25/tab/speaker/', cleanSpeakerTab],
        ['4', 'https://b.calicotab.com/calm25/', '<html></html>'],
        ['5', 'https://c.calicotab.com/quiet24/tab/speaker/', harmlessSpeakerTab],
        ['6', 'https://c.calicotab.com/quiet24/participants/list/', harmlessParticipants],
      ];
      const index = docs.map(([id, url, body]) => {
        writeFileSync(join(dir, `${id}.html.gz`), gzipSync(body));
        return JSON.stringify({ id, url, status: 200, contentHash: id, contentLength: body.length, fetchedAt: '2026-10-01T00:00:00.000Z', file: `${id}.html.gz` });
      });
      writeFileSync(join(dir, 'index.jsonl'), index.join('\n') + '\n');

      const stdout = execFileSync(process.execPath, ['scripts/find-identity-affected-tournaments.mjs', '--in', dir], { encoding: 'utf8' });
      expect(stdout).toMatch(/Tournament URLs with a tab page: 3 \(on 3 hosts\)/);
      expect(stdout).toMatch(/Affected \(a or real collision\):\s+2 of 3/);
      expect(stdout).toMatch(/\(b\) shared key in one list:\s+2 tournaments, 4 groups/);
      expect(stdout).toMatch(/real collisions \(same-role or cross-role\): 2 tournaments/);
      expect(stdout).toMatch(/same-role:\s+1 tournaments, 1 groups/);
      expect(stdout).toMatch(/cross-role:\s+2 tournaments, 2 groups/);
      expect(stdout).toMatch(/same institution:\s+0 tournaments, 0 groups/);
      expect(stdout).toMatch(/institution unknown:\s+2 tournaments, 2 groups/);
      expect(stdout).toMatch(/duplicate rows:\s+1 tournaments, 1 groups/);
      expect(stdout).toMatch(/judge role dropped by the participants merge: 1 tournaments, 1 groups \(how a cross-role collision shows today/);

      const csv = readFileSync(join(dir, 'identity-affected-tournaments.csv'), 'utf8').split('\r\n');
      // open26: Rahul Sharma on two teams (same-role); José / Jos Silva as a
      // judge listed before a speaker (cross-role, judge row lost).
      expect(csv[1]).toMatch(/^https:\/\/a\.calicotab\.com\/open26\/,a\.calicotab\.com,open26,true,1,2,4,1,1,0,0,1,0,1,/);
      // quiet24: a duplicate row (not counted) and a speaker and a judge
      // named Mia Fox (two people: counted).
      expect(csv[2]).toMatch(/^https:\/\/c\.calicotab\.com\/quiet24\/,c\.calicotab\.com,quiet24,true,0,2,4,0,1,0,0,1,1,0,/);
      expect(csv[3]).toMatch(/^https:\/\/b\.calicotab\.com\/calm25\/,b\.calicotab\.com,calm25,false,0,0,0,0,0,0,0,0,0,0,/);
      expect(readFileSync(join(dir, 'identity-affected-tournaments.txt'), 'utf8')).toBe(
        'https://a.calicotab.com/open26/\nhttps://c.calicotab.com/quiet24/\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
