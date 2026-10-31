import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ImportList, ImportRowData } from '@/lib/admin/importsList';
import type { ParserList, ParserRowData } from '@/lib/admin/parserList';
import type { CvReportList, CvReportView } from '@/lib/admin/cvReports';
import type { ReviewFlagView } from '@/lib/admin/reviewSet';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task R6: the Imports, Reports and Parser tabs show what needs the owner,
// each with Mark checked and a Checked filter that lists the marks with Undo;
// the Review set pages 20 a time and names an accuracy check flag by its
// tournament and check.

const h = vi.hoisted(() => ({
  imports: vi.fn(),
  parser: vi.fn(),
  reports: vi.fn(),
  held: vi.fn(),
  counts: vi.fn(),
  marks: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/admin/importsList', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/importsList')>()),
  listImports: h.imports,
}));
vi.mock('@/lib/admin/parserList', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/parserList')>()),
  listParser: h.parser,
}));
vi.mock('@/lib/admin/cvReports', () => ({ listCvReports: h.reports }));
vi.mock('@/lib/admin/reportsChecked', () => ({
  heldReportMarks: h.held,
  reportCounts: h.counts,
}));
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  marksFor: h.marks,
}));

const { ImportsTab } = await import('@/components/admin/tabs/ImportsTab');
const { ParserTab } = await import('@/components/admin/tabs/ParserTab');
const { ReportsTab } = await import('@/components/admin/tabs/ReportsTab');
const { ReviewSetSection } = await import('@/components/admin/ReviewSetSection');
const { fingerprintOf } = await import('@/lib/admin/adminChecks');

const NOW = new Date('2026-10-31T12:00:00Z');
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const tab = async (el: Promise<React.ReactElement>) => html(await el);
const text = (out: string) => out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const importRow = (over: Partial<ImportRowData> = {}): ImportRowData => ({
  key: 'new.calicotab.com/new2026',
  section: 'failing',
  name: 'new.calicotab.com/new2026',
  tournamentId: null,
  tabUrl: 'https://new.calicotab.com/new2026/privateurls/s3cret/',
  tab: { state: 'missing', tournamentId: null, errors: [] },
  error: 'The tournament page was not found.',
  attempts: 3,
  users: ['maya@example.com', 'noor@example.com'],
  moreUsers: 2,
  latest: new Date('2026-10-31T09:00:00Z'),
  jobIds: ['j1', 'j2'],
  scrapedAt: null,
  fingerprint: '0123456789abcdef',
  checked: null,
  changed: false,
  ...over,
});
const importList = (over: Partial<ImportList> = {}): ImportList => ({
  rows: [importRow()],
  total: 1,
  page: 1,
  pages: 1,
  filter: 'failing',
  counts: { failing: 1, covered: 5, checked: 2 },
  retryJobIds: [],
  truncated: false,
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.marks.mockResolvedValue(new Map());
  h.held.mockResolvedValue(new Map());
  h.counts.mockResolvedValue({
    open: 4,
    acknowledged: 2,
    fixed: 7,
    wont_fix: 1,
    all: 14,
    checked: 3,
  });
});

describe('Imports tab', () => {
  it('lists the failing view with its users, the chips with their counts, and Export errors', async () => {
    h.imports.mockResolvedValue(importList());
    const out = await tab(ImportsTab({ search: {}, now: NOW }));
    expect(out).toMatch(/<h2[^>]*>Failed imports<\/h2>/);
    expect(out).toContain('Export errors');
    expect(text(out)).toContain('Failing 1');
    expect(text(out)).toContain('Covered by stored copy 5');
    expect(text(out)).toContain('Checked 2');
    expect(text(out)).toContain('All 8');
    expect(out).toMatch(/aria-current="true"[^>]*>Failing/);
    expect(out).toContain('maya@example.com');
    expect(text(out)).toContain('+2 more');
    expect(out).toContain('>Mark checked<');
    // Public address only.
    expect(out).toContain('href="https://new.calicotab.com/new2026/"');
    expect(out).not.toContain('s3cret');
  });

  it('reads ?imports= and ?importsPage= for the list, and keeps the view in the pager', async () => {
    h.imports.mockResolvedValue(importList({ filter: 'covered', total: 45, pages: 3, page: 2 }));
    const out = await tab(
      ImportsTab({ search: { imports: 'covered', importsPage: '2' }, now: NOW }),
    );
    expect(h.imports).toHaveBeenCalledWith({ filter: 'covered', page: 2 });
    expect(out).toContain('the user already has this tournament from the stored copy');
    expect(out).toMatch(/aria-label="Failed import pages"/);
    expect(out).toContain('href="/admin?imports=covered&amp;importsPage=3#failed-imports"');
    expect(out).toContain('href="/admin?imports=covered#failed-imports"');
  });

  it('lists checked imports with who and when, and Undo, not Fix', async () => {
    h.imports.mockResolvedValue(
      importList({
        filter: 'checked',
        rows: [importRow({ checked: { by: 'owner@x.org', at: new Date('2026-10-30T10:00:00Z') } })],
      }),
    );
    const out = await tab(ImportsTab({ search: { imports: 'checked' }, now: NOW }));
    expect(text(out)).toContain('Checked by owner on 30 Oct 2026');
    expect(out).toContain('>Undo<');
    expect(out).not.toContain('>Mark checked<');
    expect(out).not.toContain('>Fix<');
  });

  it('labels a row that came back, and says why an empty view is empty', async () => {
    h.imports.mockResolvedValue(importList({ rows: [importRow({ changed: true })] }));
    const back = await tab(ImportsTab({ search: {}, now: NOW }));
    expect(back).toContain('Changed since you checked it');
    h.imports.mockResolvedValue(importList({ rows: [], total: 0, filter: 'checked' }));
    const empty = await tab(ImportsTab({ search: { imports: 'checked' }, now: NOW }));
    expect(empty).toContain('Nothing is marked checked');
  });
});

const warning = (over: Partial<ParserRowData> = {}): ParserRowData => ({
  key: 'parseTabs|parse: round 3 -> 0 results',
  parserName: 'parseTabs',
  headline: 'parse: round 3 -> 0 results',
  count: 12,
  latestAt: new Date('2026-10-31T09:00:00Z'),
  sample: 'parse: round 3 -> 0 results',
  tournaments: [],
  moreTournaments: 0,
  fingerprint: '0123456789abcdef',
  checked: null,
  changed: false,
  ...over,
});
const parserList = (over: Partial<ParserList> = {}): ParserList => ({
  rows: [warning()],
  total: 1,
  page: 1,
  pages: 1,
  filter: 'problems',
  counts: { problems: 1, info: 184, checked: 3 },
  ...over,
});

describe('Parser tab', () => {
  it('opens on the problems, and Informational is a view of its own', async () => {
    h.parser.mockResolvedValue(parserList());
    const out = await tab(ParserTab({ search: {}, now: NOW }));
    expect(h.parser).toHaveBeenCalledWith({ filter: 'problems', page: 1, now: NOW });
    expect(text(out)).toContain('Problems 1');
    expect(text(out)).toContain('Informational 184');
    expect(text(out)).toContain('Checked 3');
    expect(out).toContain('>Mark checked<');
    expect(out).toContain('href="/admin?parser=info#parser-warnings"');
  });

  it('explains the informational view, and offers nothing to mark there', async () => {
    h.parser.mockResolvedValue(
      parserList({
        filter: 'info',
        rows: [
          warning({
            headline: 'timing: competition likely finished',
            key: 'parseTabs|timing: competition likely finished',
            fingerprint: null,
          }),
        ],
      }),
    );
    const out = await tab(ParserTab({ search: { parser: 'info' }, now: NOW }));
    expect(h.parser).toHaveBeenCalledWith({ filter: 'info', page: 1, now: NOW });
    expect(out).toContain('These are expected states, not faults');
    expect(out).not.toContain('>Mark checked<');
    expect(out).toContain('Expected, nothing to check');
  });

  it('lists checked groups with Undo', async () => {
    h.parser.mockResolvedValue(
      parserList({
        filter: 'checked',
        rows: [warning({ checked: { by: 'owner@x.org', at: new Date('2026-10-30T10:00:00Z') } })],
      }),
    );
    const out = await tab(ParserTab({ search: { parser: 'checked' }, now: NOW }));
    expect(text(out)).toContain('Checked by owner on 30 Oct 2026');
    expect(out).toContain('>Undo<');
  });
});

const report = (over: Partial<CvReportView> = {}): CvReportView => ({
  id: 'r1',
  createdAt: new Date('2026-10-31T10:00:00Z'),
  reporter: { name: 'Maya', email: 'maya@example.com' },
  tournaments: [],
  categories: [],
  comment: 'Wrong rank',
  status: 'open',
  ...over,
});
const reportList = (over: Partial<CvReportList> = {}): CvReportList => ({
  rows: [report()],
  total: 1,
  page: 1,
  pages: 1,
  status: 'open',
  anyReports: true,
  ...over,
});

describe('Reports tab', () => {
  it('offers Mark checked on an open report, and a Checked chip', async () => {
    h.reports.mockResolvedValue(reportList());
    const out = await tab(ReportsTab({ search: {}, now: NOW }));
    expect(h.reports).toHaveBeenCalledWith({ page: 1, status: 'open' });
    expect(out).toContain('>Mark checked<');
    expect(out).toMatch(/<a[^>]*href="\/admin\?reportsStatus=checked#cv-reports"[^>]*>Checked/);
    // The same chips as Imports and Parser, with counts.
    for (const chip of ['Open 4', 'Acknowledged 2', 'Fixed 7', 'All 14', 'Checked 3']) {
      expect(text(out)).toContain(chip);
    }
  });

  it('shows a held mark as Checked by, with Undo, and a stale mark as changed', async () => {
    h.reports.mockResolvedValue(
      reportList({ rows: [report(), report({ id: 'r2' })], total: 2, status: 'all' }),
    );
    h.marks.mockResolvedValue(
      new Map([
        [
          'r1',
          {
            fingerprint: fingerprintOf('report', { status: 'open' }),
            checkedBy: 'owner@x.org',
            checkedAt: new Date('2026-10-30T10:00:00Z'),
            note: null,
          },
        ],
        [
          'r2',
          {
            fingerprint: fingerprintOf('report', { status: 'fixed' }),
            checkedBy: 'owner@x.org',
            checkedAt: new Date('2026-10-30T10:00:00Z'),
            note: null,
          },
        ],
      ]),
    );
    const out = await tab(ReportsTab({ search: { reportsStatus: 'all' }, now: NOW }));
    expect(text(out)).toContain('Checked by owner on 30 Oct 2026');
    expect(out).toContain('>Undo<');
    expect(out).toContain('Changed since you checked it');
  });
});

describe('Reports tab: Checked view', () => {
  it('the Checked filter lists the reports whose mark holds', async () => {
    const mark = {
      fingerprint: fingerprintOf('report', { status: 'acknowledged' }),
      checkedBy: 'owner@x.org',
      checkedAt: new Date('2026-10-30T10:00:00Z'),
      note: null,
    };
    h.held.mockResolvedValue(new Map([['r1', mark]]));
    h.reports.mockResolvedValue(
      reportList({ rows: [report({ status: 'acknowledged' })], status: 'all' }),
    );
    const out = await tab(ReportsTab({ search: { reportsStatus: 'checked' }, now: NOW }));
    expect(h.reports).toHaveBeenCalledWith({ page: 1, status: 'all', ids: ['r1'] });
    expect(text(out)).toContain('Checked by owner on 30 Oct 2026');
    expect(out).toContain('>Undo<');
    expect(out).toMatch(/aria-current="true"[^>]*>Checked/);
    expect(out).toContain('Undo keeps it Acknowledged');
  });
});

const flag = (over: Partial<ReviewFlagView> = {}): ReviewFlagView => ({
  id: '1',
  source: 'audit_check',
  sourceId: '5:champion',
  priority: 'medium',
  comment: 'look',
  status: 'open',
  url: 'https://oxiv.calicotab.com/oxiv2025/',
  tournament: { id: '5', name: 'Oxford IV' },
  lastError: null,
  attempts: null,
  tab: { state: 'loaded', tournamentId: '5', errors: [] },
  detail: { kind: 'audit_check', tournament: { id: '5', name: 'Oxford IV' }, check: 'Champion' },
  createdBy: 'admin@example.com',
  createdAt: new Date('2026-10-30T12:00:00Z'),
  ...over,
});

describe('Review set', () => {
  it('names an accuracy check flag by its tournament and check, and a vanished check in words', () => {
    const out = html(
      React.createElement(ReviewSetSection, {
        now: NOW,
        flags: [flag(), flag({ id: '2', sourceId: '5:gone', detail: null })],
      }),
    );
    expect(out).toContain('Oxford IV · Champion');
    expect(out).toContain('Check no longer exists');
    expect(out).toContain('Accuracy check');
  });

  it('pages 20 a time through ?reviewPage=, keeping Show done on the address', () => {
    const flags = Array.from({ length: 45 }, (_, i) =>
      flag({ id: String(i + 1), sourceId: `5:c${i}`, detail: null, comment: `flag ${i + 1}` }),
    );
    const out = html(
      React.createElement(ReviewSetSection, {
        now: NOW,
        flags,
        search: { review: 'all', reviewPage: '2' },
      }),
    );
    expect(out).toMatch(/aria-label="Review set pages"/);
    expect(text(out)).toContain('21–40 of 45');
    expect(out).toContain('href="/admin?review=all&amp;reviewPage=3#review-set"');
    expect(out.match(/ data-flag="/g)).toHaveLength(20);
  });

  it('hides done flags until Show done, a link that sets ?review=all', () => {
    const flags = [flag(), flag({ id: '9', status: 'done', comment: 'finished' })];
    const closed = html(React.createElement(ReviewSetSection, { now: NOW, flags }));
    expect(closed).not.toContain('finished');
    expect(closed).toContain('href="/admin?review=all#review-set"');
    const open = html(
      React.createElement(ReviewSetSection, { now: NOW, flags, search: { review: 'all' } }),
    );
    expect(open).toContain('finished');
  });
});
