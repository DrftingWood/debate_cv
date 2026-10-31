import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseBreakPage } from '@/lib/calicotab/parseTabs';

// A Tabbycat team break tab has two rank-like columns: "Rk" (standing in the
// tab, which counts teams that withdrew or broke in another category) and
// "Break" (the break rank, or a remark such as "(withdrawn)" where the team
// did not break). Break is the authoritative one. Diliman Schools AP 2023
// stored two withdrawn teams as breakers and read Rk as the break rank.

const URL_OPEN = 'https://x.calicotab.com/t/break/teams/open/';

type Col = { key: string; title?: string };
function vuePage(heads: Col[], rows: string[][]): string {
  const data = rows.map((r) => r.map((text) => ({ text })));
  const json = JSON.stringify([{ head: heads, data }]);
  return `<html><body><script>window.vueData = { tablesData: ${json} };</script></body></html>`;
}

const HEADS: Col[] = [
  { key: 'Rk', title: 'Rk' },
  { key: 'break', title: 'Break' },
  { key: 'team' },
  { key: 'institution' },
  { key: 'Wins', title: 'Wins' },
];

describe('parseBreakPage — Break column is the break rank', () => {
  test('reads Break, not Rk, and drops teams with a remark or blank', () => {
    const html = vuePage(HEADS, [
      ['1', '1', 'Alpha', 'A', '4'],
      ['2', '2', 'Beta', 'B', '4'],
      ['3', '(withdrawn)', 'Gamma', 'C', '3'],
      ['4', '3', 'Delta', 'D', '3'],
      ['5', '', 'Epsilon', 'E', '3'],
      ['6', '-', 'Zeta', 'F', '2'],
      ['7', '(ineligible)', 'Eta', 'G', '2'],
      ['8', '(different break)', 'Theta', 'H', '2'],
      ['9', '(capped)', 'Iota', 'I', '2'],
      ['10', '(disqualified)', 'Kappa', 'K', '2'],
      ['11', '(lost coin toss)', 'Lambda', 'L', '2'],
    ]);
    const rows = parseBreakPage(html, URL_OPEN);
    expect(rows.map((r) => [r.entityName, r.rank])).toEqual([
      ['Alpha', 1],
      ['Beta', 2],
      ['Delta', 3],
    ]);
  });

  test('matches columns by header name, not position', () => {
    const heads: Col[] = [
      { key: 'team' },
      { key: 'break', title: 'Break' },
      { key: 'institution' },
      { key: 'Rk', title: 'Rk' },
    ];
    const html = vuePage(heads, [
      ['Alpha', '1', 'A', '2'],
      ['Beta', '(withdrawn)', 'B', '1'],
    ]);
    const rows = parseBreakPage(html, URL_OPEN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityName: 'Alpha', rank: 1, institution: 'A' });
  });

  test('a Remark column does not stand in for the rank', () => {
    const heads: Col[] = [{ key: 'Remark', title: 'Remark' }, { key: 'team' }, { key: 'Rk' }];
    const html = vuePage(heads, [
      ['', 'Alpha', '1'],
      ['Withdrawn', 'Beta', '2'],
      ['Disqualified', 'Gamma', '3'],
      ['Lost coin toss', 'Delta', '4'],
      ['Reserve', 'Epsilon', '5'],
    ]);
    const rows = parseBreakPage(html, URL_OPEN);
    expect(rows.map((r) => [r.entityName, r.rank])).toEqual([['Alpha', 1]]);
  });
});

describe('parseBreakPage — rank-only tabs', () => {
  test('a tab with only a rank column keeps reading it (no Break column)', () => {
    const html = vuePage(
      [{ key: 'Rk', title: 'Rk' }, { key: 'team' }],
      [
        ['1', 'Alpha'],
        ['2', 'Beta'],
      ],
    );
    const rows = parseBreakPage(html, URL_OPEN);
    expect(rows.map((r) => [r.entityName, r.rank])).toEqual([
      ['Alpha', 1],
      ['Beta', 2],
    ]);
  });
});

describe('parseBreakPage — fallbacks', () => {
  test('adjudicator break tabs still carry no rank', () => {
    const html = vuePage(
      [{ key: 'Rk' }, { key: 'break' }, { key: 'adjudicator' }],
      [['1', '1', 'Judge']],
    );
    const rows = parseBreakPage(html, 'https://x.calicotab.com/t/break/adjudicators/');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rank).toBeNull();
  });
});

describe('parseBreakPage — Diliman Schools AP 2023 (real public tab)', () => {
  const open = readFileSync(
    'tests/fixtures/calicotab/diliman-schools-ap-2023-break-open.html',
    'utf8',
  );

  test('withdrawn teams are not breakers and ranks come from Break', () => {
    const rows = parseBreakPage(
      open,
      'https://dilimandebating.calicotab.com/dilimanschoolsap23/break/teams/open/',
    );
    const names = rows.map((r) => r.entityName);
    expect(names.some((n) => n.startsWith('BSM CAT'))).toBe(false);
    expect(names).not.toContain('Burning Fire Tornado');
    expect(rows).toHaveLength(8);
    // Rk 5..10 are Break 4..8 once the two withdrawn teams are skipped.
    expect(rows.find((r) => r.entityName === 'Hammers A')!.rank).toBe(8);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
