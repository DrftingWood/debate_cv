import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ImportList, ImportRowData } from '@/lib/admin/importsList';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Server-render checks for the admin overview: the failed-imports ledger
// (Task R6: grouped per tournament, stored ones apart), with data and
// without. The page's data sources are mocked; the client components render
// their first paint through react-dom/server.

const imports = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => ({ id: 'admin' })) }));
vi.mock('@/lib/admin/importsList', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/importsList')>()),
  listImports: vi.fn(async () => imports.current),
}));
// The accuracy section has its own render suite (admin.accuracy.render.test.ts).
vi.mock('@/lib/admin/accuracy', () => ({
  getAccuracyOverview: vi.fn(async () => ({
    weighted: null,
    unweighted: null,
    n: 0,
    onCvs: 0,
    bands: { good: 0, check: 0, rescrape: 0 },
    checked: 0,
    failingByCheck: [],
    warningByCheck: [],
    stale: 0,
    tournaments: 0,
    openQuestions: [],
  })),
}));
// The shell's summary line has its own suite (admin.shell.render.test.ts).
vi.mock('@/lib/admin/summary', () => ({
  getSummary: vi.fn(async () => ({ needsYou: 0, accuracy: null, importsFailing: 0, queue: 0 })),
  readInbox: vi.fn(),
  // The Tournaments tab's cached overview is the mocked accuracy read.
  readOverview: async () => (await import('@/lib/admin/accuracy')).getAccuracyOverview(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    tournament: { count: vi.fn(async () => 12), findMany: vi.fn(async () => []) },
    tournamentAudit: { findMany: vi.fn(async () => []) },
    discoveredUrl: { count: vi.fn(async () => 40) },
    ingestJob: { count: vi.fn(async () => 3) },
    parserRun: { findMany: vi.fn(async () => []) },
    cvErrorReport: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    reviewFlag: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const NOW = Date.now();
const minutes = (n: number) => new Date(NOW + n * 60_000);

const base: ImportRowData = {
  key: '',
  section: 'failing',
  name: '',
  tournamentId: null,
  tabUrl: null,
  tab: { state: 'missing', tournamentId: null, errors: [] },
  error: '',
  attempts: 3,
  users: [],
  moreUsers: 0,
  latest: null,
  jobIds: [],
  scrapedAt: null,
  fingerprint: null,
  checked: null,
  changed: false,
};

// One tournament that is not stored (two users failed on it) and one the
// stored copy covers (partly loaded).
const failing: ImportRowData = {
  ...base,
  key: 'newt.calicotab.com/newt2026',
  name: 'newt.calicotab.com/newt2026',
  tabUrl: 'https://newt.calicotab.com/newt2026/privateurls/zzz999/',
  error: 'The tournament page was not found.',
  users: ['sam@example.com', 'noor@example.com'],
  latest: minutes(-30),
  jobIds: ['job-2', 'job-3'],
  fingerprint: '0123456789abcdef',
};
const covered: ImportRowData = {
  ...base,
  key: 'stored:5',
  section: 'covered',
  name: 'Oxford IV 2025',
  tournamentId: '5',
  tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
  tab: { state: 'partial', tournamentId: '5', errors: ['R3: HTTP 503 Service Unavailable'] },
  error: 'The tab site had a problem on its side.',
  users: ['maya@example.com'],
  latest: minutes(-120),
  jobIds: ['job-1'],
  scrapedAt: minutes(-600),
};

const list = (rows: ImportRowData[], filter: ImportList['filter']): ImportList => ({
  rows,
  total: rows.length,
  page: 1,
  pages: 1,
  filter,
  counts: { failing: 1, covered: 1, checked: 0 },
  retryJobIds: [],
  truncated: false,
});
const full = list([failing, covered], 'all');
const empty = list([], 'failing');

async function renderPage(data: ImportList): Promise<string> {
  imports.current = data;
  return renderTabs(['tournaments', 'imports', 'review', 'tools'], { imports: 'all' });
}

/**
 * The tabs this suite reads, rendered one after another: each tab is its own
 * request now, and these checks are about the sections, not the strip.
 */
async function renderTabs(tabs: string[], extra: Record<string, string> = {}): Promise<string> {
  const { default: AdminPage } = await import('@/app/(app)/admin/page');
  const out: string[] = [];
  for (const tab of tabs) {
    out.push(
      renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ tab, ...extra }) })),
    );
  }
  return out.join('\n');
}

describe('admin overview', () => {
  beforeEach(() => {
    imports.current = null;
  });

  // Owner, 2026-10-31: the section said "Every tracked tournament loaded in
  // full", which is not news; partly loaded tournaments reach the Inbox as
  // checks instead.
  it('no longer renders the Scrape health section or the state tiles', async () => {
    const out = await renderPage(full);
    expect(out).not.toContain('Scrape health');
    expect(out).not.toContain('Partly loaded tournaments');
    expect(out).not.toContain('Current state');
    expect(out).not.toContain('of 9 tracked');
  });

  // Final review of PR #265: an unguarded accuracy read took all of /admin down.
  it('still renders when the accuracy overview cannot be read, and says so', async () => {
    const mod = await import('@/lib/admin/accuracy');
    vi.mocked(mod.getAccuracyOverview).mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await renderPage(full);
    expect(out).toContain('Failed imports');
    expect(out).toContain('Couldn&#x27;t load the filters');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lists failed imports in words, one row per tournament with its users', async () => {
    const out = await renderPage(full);
    expect(out).toMatch(/<h2[^>]*>Failed imports<\/h2>/);
    // The public tab address only: the private key never reaches the markup.
    expect(out).toContain('href="https://newt.calicotab.com/newt2026/"');
    expect(out).not.toContain('zzz999');
    expect(out).toContain('The tournament page was not found.');
    expect(out).toContain('The tab site had a problem on its side.');
    expect(out).toContain('sam@example.com');
    expect(out).toContain('noor@example.com');
    expect(out).toContain('Mark checked');
    expect(out).toContain('Export errors');
  });

  it('states why when nothing is failing', async () => {
    const out = await renderPage(empty);
    expect(out).toContain('No failed import needs you');
    expect(out).not.toContain('Mark checked');
  });
});

describe('admin overview: is it in the database? (Task 5b)', () => {
  beforeEach(() => {
    imports.current = null;
  });

  // Task 5b: a failed import says whether its tournament is stored. Since
  // Task R6 the stored ones are listed apart, as covered by the stored copy.
  it('says a covered tournament is stored, and not stored ones are not marked as stored', async () => {
    const out = await renderPage(full);
    const rows = out.split('<tr');
    const oxford = rows.find((r) => r.includes('Oxford IV 2025'))!;
    const newt = rows.find((r) => r.includes('newt.calicotab.com'))!;
    expect(oxford).toContain('Stored');
    expect(oxford).toMatch(/href="\/admin\/tournaments\/5"/);
    expect(oxford).toContain('10 h ago');
    expect(oxford).toContain('the user already has this tournament from the stored copy');
    expect(newt).not.toContain('Stored');
    expect(newt).not.toContain('/admin/tournaments/');
  });

  it('links every tournament and offers the lookup, which posts its text', async () => {
    const out = await renderPage(full);
    expect(out).not.toContain('All tournaments');
    expect(out).toMatch(/<form[^>]*action="\/api\/admin\/lookup\/search"[^>]*method="post"/);
    expect(out).toMatch(/<label[^>]*>Tournament or private URL<\/label>/);
    expect(out).toContain('>Look up<');
    expect(out).toMatch(/role="status"[^>]*aria-live="polite"/);
  });
});

describe('admin overview: tab status and the review set (Task 5c)', () => {
  it('puts the Tab column on each failed import and the review set right after them', async () => {
    const out = await renderPage(full);
    expect(out).toMatch(/<th[^>]*>Tab<\/th>/);
    expect(out).toContain('Partly');
    expect(out).toContain('R3: HTTP 503 Service Unavailable');
    expect(out).toContain('Not loaded');
    const failed = out.indexOf('>Failed imports</h2>');
    const review = out.indexOf('>Flagged for review</h2>');
    expect(failed).toBeGreaterThan(0);
    expect(review).toBeGreaterThan(failed);
    expect(out).toContain('Nothing flagged yet');
  });
});

describe('Retry failed while the request runs (UX-22)', () => {
  it('says what is happening and how long it can take', async () => {
    const { RetryPiecesView } = await import('@/components/admin/RetryPiecesButton');
    const props = { tournamentName: 'Oxford IV 2025', error: null, onRetry: () => {} };
    const busy = renderToStaticMarkup(
      React.createElement(RetryPiecesView, { ...props, pending: true }),
    );
    expect(busy).toContain('Retrying…');
    expect(busy).toMatch(
      /role="status"[^>]*>Re-scraping the failed pages of Oxford IV 2025\. This can take up to a minute\.</,
    );
    expect(busy).toContain('aria-busy="true"');
    // The status region exists before it has anything to say, so the
    // message is announced when it appears (UX-19).
    const idle = renderToStaticMarkup(
      React.createElement(RetryPiecesView, { ...props, pending: false }),
    );
    expect(idle).toMatch(/role="status"[^>]*><\/p>/);
    expect(idle).toContain('Retry failed');
  });
});
