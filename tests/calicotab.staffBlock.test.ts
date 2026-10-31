import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseParticipantsList } from '@/lib/calicotab/parseTabs';
import { parseStaffBlock, parseStaffText, splitStaffNames } from '@/lib/calicotab/staffBlock';
import { matchStaffName } from '@/lib/calicotab/staffMatch';

/**
 * The evidence file "Missing tabs - CA and adjudication core roles
 * 2026-10-27" lists, per tournament, what its home page's Tournament Staff
 * block says and whether the participants list ticks Adj Core on the owner's
 * row. Each fixture under tests/fixtures/staff is that block; the Adj Core
 * column is rebuilt in the participants table shape the parser reads.
 */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/staff/${name}.html`, import.meta.url), 'utf8');

const OWNER = 'Abhishek Acharya';
const OWNER_PERSON = { personId: 1n, displayName: OWNER };
const CHECK = { icon: 'check', sort: 1 };
const BLANK = { icon: '', sort: 2 };

function participantsPage(adjCore: boolean, independent: boolean): string {
  const payload = {
    tablesData: [
      {
        head: [{ key: 'name' }, { key: 'adjcore' }, { key: 'independent' }, { key: 'rating' }],
        data: [
          [{ text: OWNER }, adjCore ? CHECK : BLANK, independent ? CHECK : BLANK, { text: '4' }],
        ],
      },
    ],
  };
  return `<html><body><script>var x = ${JSON.stringify(payload)};</script></body></html>`;
}

/** Core by either source, as the check reads them. */
function isCore(page: string, adjCore: boolean, independent: boolean): boolean {
  const row = parseParticipantsList(participantsPage(adjCore, independent))?.find(
    (r) => r.name === OWNER,
  );
  const fromList = row?.judgeTag === 'core';
  const fromStaff = parseStaffBlock(page).core.some(
    (n) => matchStaffName(n, [OWNER_PERSON]).exact != null,
  );
  return fromList || fromStaff;
}

describe('Tournament Staff block against the evidence file', () => {
  // [fixture, Adj Core ticked, Independent ticked, expected core]
  const cases: Array<[string, boolean, boolean, boolean]> = [
    ['synthetic-asdc2022', true, false, true],
    ['vivaad2022', true, false, true],
    ['shriram-preabp2022', true, false, true],
    ['cnlu13-2022', true, false, true],
    ['east-malaysia-open-2022', true, false, true],
    ['pop-posting-2021', true, false, true],
    ['sls-pd-2024', false, true, false],
    ['alfaaz-open', false, true, false],
  ];
  test.each(
    cases.map(([name, adjCore, independent, expected]) => ({
      name,
      adjCore,
      independent,
      expected,
    })),
  )('$name', ({ name, adjCore, independent, expected }) => {
    expect(isCore(fixture(name), adjCore, independent)).toBe(expected);
  });

  test('a staff block alone settles the tournaments whose list is not public', () => {
    // Core by the staff block with no Adj Core tick: Vivaad names him under
    // the Core Adjudication Panel even if the list were unreadable.
    expect(isCore(fixture('vivaad2022'), false, false)).toBe(true);
    // SLS and Alfaaz name other people, never him, whichever way the list reads.
    expect(isCore(fixture('sls-pd-2024'), false, false)).toBe(false);
    expect(isCore(fixture('alfaaz-open'), false, false)).toBe(false);
  });
});

describe('Tournament Staff block: the real public home pages', () => {
  // Saved from the live tabs (no private URLs); the exact lists the pages carry.
  const REAL: Array<[string, string[]]> = [
    ['cnlu13-2022', ['Shruti Deb', 'Vignesh Hariharan', 'Abhishek Acharya', 'Kevin Santosh']],
    [
      'vivaad2022',
      [
        'Matthew Conley-Evans',
        'Abheepsita Purkayastha',
        'Apratim',
        'Abhishek Acharya',
        'Mehul Joshi',
        'Leauren Shiyuan Ji',
      ],
    ],
    [
      'east-malaysia-open-2022',
      ['Abhishek Acharya', 'Bea Legaspi', 'Gareth Lim', 'Kuhan Karttikeyn'],
    ],
    [
      'sls-pd-2024',
      ['Angad Singh Chawla', 'Charlie Ryan', 'David Africa', 'Maeca Pansensoy', 'Nayantara'],
    ],
    // The Tab Team, Equity Panel and Org Comm lines above it are not core.
    ['shriram-preabp2022', ['Abhishek Acharya', 'Anum Naseer', 'Ira Gosavi', 'Davida Paul']],
    [
      'pop-posting-2021',
      [
        'Jess Musulin',
        'Naomi Panovka',
        'Ron Leizrowice',
        'Parth Pandya',
        'Daan Spackler',
        'Abhishek Acharya',
        'Noluthando Honono',
        'Jeremiah Edagbami',
        'Sher May Nar',
      ],
    ],
    ['alfaaz-open', ['Shruti Deb', 'Jaymal Lodha', 'Rob Barrie', 'Tejas Subramaniam']],
  ];
  test.each(REAL.map(([name, names]) => ({ name, names })))('$name', ({ name, names }) => {
    const block = parseStaffBlock(fixture(name));
    expect(block.found).toBe(true);
    expect(block.core).toEqual(names);
  });

  test('no real page carries a private URL', () => {
    for (const [name] of REAL) expect(fixture(name)).not.toMatch(/privateurls/i);
  });
});

describe('Tournament Staff block: other shapes', () => {
  test('Deputy Chief Adjudicators and Chief Adjudicators both count (Uhuru)', () => {
    const core = parseStaffBlock(fixture('synthetic-uhuru-worlds-2022')).core;
    expect(core).toContain('Sebastien Ezeta');
    expect(core).toContain('Bea Legaspi');
    // "Abishek" is the tab's own spelling; it does not match the profile name.
    expect(core.some((n) => matchStaffName(n, [OWNER_PERSON]).exact != null)).toBe(false);
  });

  test('a core list and a following label on one line: only the core is read', () => {
    const html =
      '<div class="card"><div class="card-header">Tournament Staff</div><div class="card-body">' +
      'Core Adjudicators: [Ada Lovelace, Grace Hopper] Equity Panel: [Alan Turing, Kurt Godel]' +
      '</div></div>';
    expect(parseStaffBlock(html).core).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  test('a page with no Tournament Staff block is found:false', () => {
    expect(parseStaffBlock('<html><body><h1>Welcome</h1></body></html>')).toEqual({
      found: false,
      core: [],
    });
  });

  test('a block that names no core is found with no names', () => {
    const html = '<div class="card"><h4>Tournament Staff</h4><p>Tabulation: Ada</p></div>';
    expect(parseStaffBlock(html)).toEqual({ found: true, core: [] });
  });
});

describe('staff names', () => {
  test('splits on commas, ampersands, "and" and new lines, and drops bracketed roles', () => {
    expect(
      splitStaffNames(
        'Ada Lovelace (CA), Grace Hopper & Alan Turing and Kurt Godel\nEmmy Noether [DCA]',
      ),
    ).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Kurt Godel', 'Emmy Noether']);
  });

  test('placeholders and repeats are dropped', () => {
    expect(splitStaffNames('TBA, Ada Lovelace, ada  lovelace, N/A')).toEqual(['Ada Lovelace']);
  });

  test('short labels CA, CAP and DCA are core headings', () => {
    expect(
      parseStaffText('CA: Ada Lovelace\nCAP: Grace Hopper\nDCAs: Alan Turing, Kurt Godel'),
    ).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Kurt Godel']);
  });

  test('an unknown label on its own line ends a core list', () => {
    expect(parseStaffText('Adjudication: Ada Lovelace\nCatering: Grace Hopper')).toEqual([
      'Ada Lovelace',
    ]);
  });
});
