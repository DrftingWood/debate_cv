import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CvReportList, CvReportView } from '@/lib/admin/cvReports';
import type { ParserWarningList, ParserWarningView } from '@/lib/admin/parserWarnings';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task 5d render checks: the CV reports and parser warnings ledgers, their
// Tab cells and public "Tab ↗" links, the row counts and pager links (which
// keep the page's other parameters), the phone layout's col/cell parity and
// the distinct empty states.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { CvReportsSection } = await import('@/components/admin/CvReportsSection');
const { ParserWarningsSection } = await import('@/components/admin/ParserWarningsSection');
const { TabStatus } = await import('@/components/admin/TabStatus');
const { adminHref } = await import('@/lib/admin/adminHref');

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const NOW = new Date('2026-10-31T12:00:00Z');

const reportRow = (over: Partial<CvReportView> = {}): CvReportView => ({
  id: 'r1',
  createdAt: new Date('2026-10-31T10:00:00Z'),
  reporter: { name: 'Maya', email: 'maya@example.com' },
  tournaments: [
    {
      id: '7',
      name: 'Oxford IV',
      stored: true,
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      tab: { state: 'partial', tournamentId: '7', errors: ['R2: HTTP 503 Service Unavailable'] },
      suggested: [{ kind: 'speaker', key: '', label: 'Speaker tab', url: null }],
    },
    {
      id: '99',
      name: 'Tournament #99',
      stored: false,
      tabUrl: null,
      tab: { state: 'missing', tournamentId: null, errors: [] },
      suggested: [],
    },
  ],
  categories: [{ code: 'wrong_speaker_rank', label: 'Wrong speaker rank' }],
  comment: 'My rank is wrong',
  status: 'open',
  ...over,
});

const reports = (over: Partial<CvReportList> = {}): CvReportList => ({
  rows: [reportRow()],
  total: 87,
  page: 2,
  pages: 5,
  status: 'open',
  anyReports: true,
  ...over,
});

const warningRow = (over: Partial<ParserWarningView> = {}): ParserWarningView => ({
  key: 'parseTabs|Bad row',
  parserName: 'parseTabs',
  headline: 'Bad row',
  count: 12,
  latestAt: new Date('2026-10-31T09:00:00Z'),
  sample: 'Bad row — at https://oxiv.calicotab.com/oxiv2025/',
  tournaments: [
    {
      id: '7',
      name: 'Oxford IV',
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      tab: { state: 'loaded', tournamentId: '7', errors: [] },
    },
    {
      id: null,
      name: 'oxiv.calicotab.com/dup',
      tabUrl: 'https://oxiv.calicotab.com/dup/',
      tab: {
        state: 'check',
        tournamentId: null,
        errors: ['2 stored tournaments share this address.'],
      },
    },
  ],
  moreTournaments: 3,
  ...over,
});

const warnings = (over: Partial<ParserWarningList> = {}): ParserWarningList => ({
  rows: [warningRow()],
  total: 1,
  page: 1,
  pages: 1,
  ...over,
});

const SEARCH = { warningsPage: '3', reportsPage: '2' };

/** Every column hidden below md is hidden as a col too, so cells keep their columns. */
function expectColParity(out: string) {
  const heads = [...out.matchAll(/<th scope="col"( class="([^"]*)")?/g)];
  const cols = [...out.matchAll(/<col( class="([^"]*)")?\s*(style="[^"]*")?\/?>/g)];
  expect(cols).toHaveLength(heads.length);
  const hidden = (c: string | undefined) => /(^|\s)hidden(\s|$)/.test(c ?? '');
  expect(cols.filter((c) => hidden(c[2])).length).toBe(heads.filter((m) => hidden(m[2])).length);
}

describe('CV error reports', () => {
  it('renders the ledger with Tab status, public tab links and the categories in words', () => {
    const out = html(h(CvReportsSection, { list: reports(), now: NOW, search: SEARCH }));
    expect(out).toMatch(/<h2[^>]*>CV error reports<\/h2>/);
    expect(out).toContain('href="/api/admin/cv-error-reports-export"');
    for (const head of ['Reported', 'Reporter', 'Tournament', 'Categories', 'Comment', 'Status']) {
      expect(out).toMatch(new RegExp(`<th[^>]*>${head}</th>`));
    }
    expect(out).toContain('2 h ago');
    expect(out).toContain('Maya');
    expect(out).toMatch(/<a[^>]*href="\/admin\/tournaments\/7"[^>]*>Oxford IV<\/a>/);
    expect(out).toContain('Partly');
    expect(out).toContain('R2: HTTP 503 Service Unavailable');
    expect(out).toContain('Not loaded');
    expect(out).toMatch(/href="https:\/\/oxiv\.calicotab\.com\/oxiv2025\/"[^>]*>Tab/);
    expect(out).not.toContain('/admin/tournaments/99');
    expect(out).toContain('Wrong speaker rank');
    expect(out).toMatch(/aria-label="Status of the report from Maya"/);
    expect(out).toContain('Re-scrape suggested (1)');
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Add to review set/);
    expectColParity(out);
  });

  it('says how many rows exist, and pages without dropping the other parameters', () => {
    const out = html(h(CvReportsSection, { list: reports(), now: NOW, search: SEARCH }));
    expect(out).toContain('21–40 of 87');
    expect(out).toContain('href="/admin?warningsPage=3#cv-reports"');
    expect(out).toContain('href="/admin?warningsPage=3&amp;reportsPage=3#cv-reports"');
    // The status filter starts again from page 1 and keeps the warnings page.
    expect(out).toContain('href="/admin?warningsPage=3&amp;reportsStatus=all#cv-reports"');
    expect(out).toMatch(/aria-current="page"[^>]*>Open</);
  });

  it('counts a single page too', () => {
    const out = html(
      h(CvReportsSection, {
        list: reports({ total: 1, page: 1, pages: 1 }),
        now: NOW,
        search: {},
      }),
    );
    expect(out).toContain('1–1 of 1');
    expect(out).not.toContain('Next →');
  });
});

describe('CV error reports, empty', () => {
  it('has two distinct empty states', () => {
    const none = html(
      h(CvReportsSection, {
        list: reports({ rows: [], total: 0, page: 1, pages: 1, anyReports: false }),
        now: NOW,
        search: {},
      }),
    );
    expect(none).toContain('No CV reports yet');
    expect(none).not.toContain('<table');
    const noneOpen = html(
      h(CvReportsSection, {
        list: reports({ rows: [], total: 0, page: 1, pages: 1, anyReports: true }),
        now: NOW,
        search: {},
      }),
    );
    expect(noneOpen).toContain('No open reports');
    expect(noneOpen).not.toContain('No CV reports yet');
  });
});

describe('parser warnings', () => {
  it('renders the ledger with counts, tournaments and their Tab status', () => {
    const out = html(h(ParserWarningsSection, { list: warnings(), now: NOW, search: SEARCH }));
    expect(out).toMatch(/<h2[^>]*>Recent parser warnings<\/h2>/);
    expect(out).toContain('from the latest 2,000 parser runs');
    for (const head of ['Parser', 'Warning', 'Count', 'Latest', 'Tournaments']) {
      expect(out).toMatch(new RegExp(`<th[^>]*>${head}</th>`));
    }
    expect(out).toMatch(/<td class="[^"]*cell-num[^"]*"[^>]*>12<\/td>/);
    expect(out).toContain('3 h ago');
    expect(out).toMatch(/<a[^>]*href="\/admin\/tournaments\/7"[^>]*>Oxford IV<\/a>/);
    expect(out).toContain('Loaded');
    expect(out).toMatch(/\?<\/span>(&nbsp;|\s)*Check/);
    expect(out).not.toContain('Not loaded');
    expect(out).toContain('+3 more');
    expect(out).toMatch(/href="https:\/\/oxiv\.calicotab\.com\/dup\/"[^>]*>Tab/);
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Add to review set/);
    expectColParity(out);
  });

  it('says so when nothing was recorded in the last 30 days', () => {
    const out = html(
      h(ParserWarningsSection, {
        list: warnings({ rows: [], total: 0 }),
        now: NOW,
        search: {},
      }),
    );
    expect(out).toContain('No parser warnings in the last 30 days');
    expect(out).not.toContain('<table');
  });
});

describe('the "? Check" Tab state', () => {
  it('has a symbol, a word, and its reason for keyboard and screen readers', () => {
    const out = html(
      h(TabStatus, {
        tab: { state: 'check', tournamentId: null, errors: ['2 stored tournaments share this.'] },
      }),
    );
    expect(out).toMatch(/\?<\/span>(&nbsp;|\s)*Check/);
    expect(out).toMatch(/<button type="button" aria-expanded="false" aria-describedby="[^"]+"/);
    expect(out).toContain('class="sr-only"><li>2 stored tournaments share this.</li>');
  });

  it('can leave out its Open link where the name already links', () => {
    const out = html(
      h(TabStatus, { tab: { state: 'loaded', tournamentId: '7', errors: [] }, open: false }),
    );
    expect(out).not.toContain('/admin/tournaments/7');
  });
});

describe('adminHref', () => {
  it('sets and removes parameters, keeping the rest', () => {
    expect(adminHref({ a: '1', b: ['2', '3'] }, { a: null, c: '4' }, 'x')).toBe(
      '/admin?b=2&b=3&c=4#x',
    );
    expect(adminHref({}, {})).toBe('/admin');
  });
});
