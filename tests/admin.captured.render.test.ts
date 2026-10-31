import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BalanceStats } from '@/lib/admin/captured';
import { foldBalance } from '@/lib/admin/capturedMath';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task R11: the Captured tab as the owner sees it. The readers are mocked;
// what is checked is what the page says: every figure with its sample size,
// the unknown rows in words, the links out, the private key nowhere, and a
// failed section saying so without taking the rest down.

const KEY = 'k3yS3cr3t';

const h = vi.hoisted(() => ({
  size: vi.fn(),
  geo: vi.fn(),
  fy: vi.fn(),
  motions: vi.fn(),
  balance: vi.fn(),
  unreleased: vi.fn(),
  overview: vi.fn(),
  noYear: vi.fn(),
}));
vi.mock('@/lib/admin/captured', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/captured')>()),
  readSize: h.size,
  readGeography: h.geo,
  readFormatsYears: h.fy,
  readMotionKinds: h.motions,
  readBalance: h.balance,
  countUnreleased: h.unreleased,
}));
vi.mock('@/lib/admin/summary', () => ({ readOverview: h.overview }));
vi.mock('@/lib/admin/yearFill', () => ({ countMissingYears: h.noYear }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

const { CapturedTab } = await import('@/components/admin/tabs/CapturedTab');

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
const render = async () => renderToStaticMarkup(await CapturedTab());

const seat = (position: string, n: number, sum: number) => ({
  position,
  rows: n,
  pointsRows: n,
  pointsSum: sum,
  winRows: 0,
  winSum: 0,
});

const balance: BalanceStats = {
  overall: foldBalance([
    seat('OG', 100, 170),
    seat('OO', 100, 150),
    seat('CG', 100, 140),
    seat('CO', 100, 140),
  ]),
  noSides: 36,
  byType: {
    shown: [
      {
        type: 'THW',
        balance: foldBalance([
          seat('OG', 40, 68),
          seat('OO', 40, 60),
          seat('CG', 40, 56),
          seat('CO', 40, 56),
        ]),
      },
    ],
    tooFew: [
      { type: 'THR', bp: 4, two: 0 },
      { type: 'THP', bp: 25, two: 25 },
    ],
  },
  unbalancedBp: [
    {
      motionId: '77',
      text: 'This House would ban zoos',
      roundLabel: 'Round 3',
      tournament: { id: '5', name: 'Oxford IV', tabUrl: 'https://ox.calicotab.com/ox/' },
      spread: 1.1,
      rooms: 12,
      seats: [
        { pos: 'CG', value: 1 },
        { pos: 'OG', value: 2.1 },
      ],
    },
  ],
  unbalancedTwo: [],
};

beforeEach(() => {
  h.size.mockResolvedValue({
    sampled: 16,
    noTeams: 4,
    bins: [4, 6, 3, 2, 1],
    median: 28,
    largest: [
      { id: '9', name: 'Worlds 2025', tabUrl: 'https://w.calicotab.com/w/', teams: 400 },
      { id: '3', name: 'Cambridge IV', tabUrl: null, teams: 120 },
    ],
  });
  h.geo.mockResolvedValue({
    total: 19,
    rows: [
      { value: 'Europe', count: 12 },
      { value: null, count: 5 },
      { value: 'Africa', count: 2 },
    ],
  });
  h.fy.mockResolvedValue({
    total: 43,
    formats: [
      { value: 'BP', count: 40 },
      { value: null, count: 3 },
    ],
    years: [
      { value: '2025', count: 13 },
      { value: null, count: 30 },
    ],
  });
  h.motions.mockResolvedValue({
    total: 57,
    types: [
      { value: 'THW', count: 50 },
      { value: null, count: 7 },
    ],
    topics: [{ value: 'Education', count: 12 }],
    topicsUntagged: 45,
  });
  h.balance.mockResolvedValue(balance);
  h.unreleased.mockResolvedValue(6);
  h.noYear.mockResolvedValue(30);
  h.overview.mockResolvedValue({
    n: 50,
    failingByCheck: [
      { code: 'format_missing', label: 'Format', count: 3 },
      { code: 'parser_stale', label: 'Old parser', count: 8 },
    ],
    warningByCheck: [{ code: 'core_missing', label: 'Adjudication core', count: 5 }],
  });
});

describe('Captured tab', () => {
  it('has the six sections in order, each an h2, and no h1', async () => {
    const out = await render();
    const heads = [...out.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      'Size',
      'Geography',
      'Formats and years',
      'Motion types',
      'Motion balance',
      'Coverage gaps',
    ]);
    expect(out).not.toMatch(/<h1[ >]/);
    expect(text(out)).toContain('Tournaments set to ignored are left out of every figure here.');
  });
});

describe('Captured tab, tournament sections', () => {
  it('gives the sizes with the median, the bins and the largest, each with its n', async () => {
    const t = text(await render());
    expect(t).toContain('28 teams');
    expect(t).toContain('Of 16 tournaments with stored teams');
    expect(t).toContain('≤16 teams 4 · 25.0%');
    expect(t).toContain('129+ teams 1 · 6.3%');
    expect(t).toContain('No teams stored 4');
    expect(t).toContain('Worlds 2025');
    expect(t).toContain('400');
  });

  it('names the unknown region, format and year in words and links their fixes', async () => {
    const out = await render();
    const t = text(out);
    expect(t).toContain('Unknown region 5 · 26.3%');
    expect(t).toContain('Region only: no country is stored.');
    expect(t).toContain('No format 3 · 7.0%');
    expect(t).toContain('No year 30 · 69.8%');
    expect(out).toContain('href="/admin?tab=tools#fill-formats"');
    expect(out).toContain('href="/admin?tab=tools#fill-years"');
  });

  it('shows the motion types with Untyped, and the topics with how many are untagged', async () => {
    const t = text(await render());
    expect(t).toContain('Untyped 7 · 12.3%');
    expect(t).toContain('n = 57 motions.');
    expect(t).toContain('Top 1 topics of 57 motions; 45 have no topic.');
  });
});

describe('Captured tab, motion sections', () => {
  it('shows the seat averages with n, the excluded team-rounds, the type split and the unbalanced list', async () => {
    const out = await render();
    const t = text(out);
    expect(t).toContain('≈ 100 rooms with a recorded side');
    expect(t).toContain('36 team-rounds without recorded sides are excluded');
    expect(t).toContain('OG 1.70 · n 100');
    expect(t).toContain('CO 1.40 · n 100');
    expect(t).toContain('Too few rooms to split: THR (4 BP), THP (25 BP · 25 two-team).');
    expect(t).toContain('rooms ≈ team-rounds ÷ 4 (BP) or ÷ 2');
    expect(t).toContain('All prelim rounds');
    expect(t.match(/Rounds with one motion only/g)).toHaveLength(2);
    expect(t).toContain('This House would ban zoos');
    expect(t).toContain('Round 3 · OG 2.10 · CG 1.00');
    expect(out).toContain('href="/admin/tournaments/5"');
    expect(out).toContain('href="https://ox.calicotab.com/ox/"');
    expect(out).toContain('rel="noopener noreferrer"');
    // The two-team list is empty: it says why, in words.
    expect(t).toContain('No motion has 8 rooms per seat with sides recorded.');
  });
});

describe('Captured tab, coverage and failures', () => {
  it('counts the gaps from the overview and links the filtered list and the bulk fix', async () => {
    const out = await render();
    expect(out).toContain('href="/admin?tab=tournaments&amp;check=format_missing"');
    expect(out).toContain('href="/admin?tab=tournaments&amp;check=parser_stale"');
    expect(out).toContain('href="/admin?tab=tournaments&amp;warn=core_missing"');
    expect(out).toContain('href="/admin?tab=tools#refresh-old"');
    const rows = [...out.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => text(m[1]!).trim());
    const row = (label: string) => rows.find((r) => r.startsWith(label))!;
    expect(out).toContain('Tournaments (audited)');
    expect(row('Missing format')).toContain('Of 50 audited tournaments');
    expect(row('Missing year')).toContain('Of all 43 stored');
    expect(row('Unreleased tabs')).toContain('Of all 43 stored');
    expect(row('Old parser')).toContain('Of 50 audited tournaments');
    expect(row('Missing format')).toContain(' 3 ');
    expect(row('Missing year')).toContain(' 30 ');
    // The core check only warns, so the gap is its warning count.
    expect(row('Missing adjudication core')).toContain(' 5 ');
    expect(row('Unreleased tabs')).toContain(' 6 ');
    expect(row('Old parser')).toContain(' 8 ');
  });

  it('keeps a failed section to itself and never writes a private key', async () => {
    h.balance.mockRejectedValue(new Error('db down'));
    h.size.mockRejectedValue(new Error('db down'));
    h.overview.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await render();
    spy.mockRestore();
    expect(out.match(/Couldn&#x27;t load/g)).toHaveLength(2);
    expect(text(out)).toContain('Unknown region 5');
    // The overview failed: the gap counts it owns show a dash, the others stay.
    expect(out).toContain('title="Could not be counted"');
    expect(out).not.toContain(KEY);
  });

  it('says why when nothing has a recorded side', async () => {
    h.balance.mockResolvedValue({
      ...balance,
      overall: foldBalance([]),
      noSides: 900,
      byType: { shown: [], tooFew: [] },
    });
    const t = text(await render());
    expect(t).toContain('No rooms with recorded sides');
    expect(t).toContain('900 team-rounds have none stored');
  });
});
