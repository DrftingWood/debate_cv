import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ImportList } from '@/lib/admin/importsList';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// The tabbed /admin (Task R3): the summary line and seven tabs above every
// panel, only the active tab's data read, the old /admin/tournaments address
// redirecting into its tab, and no "1970" anywhere an operator can see.

const h = vi.hoisted(() => ({
  accuracy: vi.fn(),
  inbox: vi.fn(),
  imports: vi.fn(),
  cvReports: vi.fn(),
  warnings: vi.fn(),
  reviewSet: vi.fn(),
  tournaments: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  }),
}));

vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => 'admin@example.com') }));
vi.mock('@/lib/admin/summary', () => ({
  getSummary: vi.fn(async () => ({
    needsYou: 7,
    accuracy: { score: 91, good: 915, check: 414, rescrape: 55 },
    importsFailing: 3,
    queue: 12,
  })),
  readInbox: h.inbox,
  readOverview: () => h.accuracy(),
}));
vi.mock('@/lib/admin/accuracy', () => ({ getAccuracyOverview: h.accuracy }));
vi.mock('@/lib/admin/importsList', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/importsList')>()),
  listImports: h.imports,
}));
vi.mock('@/lib/admin/cvReports', () => ({ listCvReports: h.cvReports }));
vi.mock('@/lib/admin/parserWarnings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/parserWarnings')>()),
  loadWarningGroups: h.warnings,
}));
vi.mock('@/lib/admin/reviewSet', () => ({ loadReviewSet: h.reviewSet }));
vi.mock('@/lib/admin/tournamentList', () => ({
  listTournaments: h.tournaments,
  TOURNAMENTS_PER_PAGE: 20,
}));
vi.mock('@/lib/admin/tournamentLookup', () => ({ lookupTournament: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    discoveredUrl: { count: vi.fn(async () => 40) },
    ingestJob: { count: vi.fn(async () => 3) },
  },
}));
vi.mock('next/navigation', () => ({
  redirect: h.redirect,
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const NOW = Date.now();
const epoch = new Date(0);

// A stored tournament the failed import is covered by, with the Re-ingest-all marker as its scrape time.
const importList: ImportList = {
  rows: [
    {
      key: 'stored:5',
      section: 'covered',
      name: 'Oxford IV 2025',
      tournamentId: '5',
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      tab: { state: 'partial', tournamentId: '5', errors: [] },
      error: 'The tournament page was not found.',
      attempts: 3,
      users: ['maya@example.com'],
      moreUsers: 0,
      latest: new Date(NOW - 3_600_000),
      jobIds: ['job-1'],
      scrapedAt: epoch,
      fingerprint: null,
      checked: null,
      changed: false,
    },
  ],
  total: 1,
  page: 1,
  pages: 1,
  filter: 'covered',
  counts: { failing: 0, covered: 1, checked: 0 },
  truncated: false,
};

const listed = (scrapedAt: Date) => ({
  rows: [
    {
      id: '5',
      name: 'Oxford IV 2025',
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      year: 2025,
      format: 'BP',
      scrapedAt,
      parserCurrent: true,
      score: 92,
      band: 'good',
      tab: { state: 'loaded', tournamentId: '5', errors: [] },
      withheld: 0,
      onCvs: 3,
    },
  ],
  total: 1,
  page: 1,
  pages: 1,
});

async function render(search: Record<string, string | undefined> = {}): Promise<string> {
  const { default: AdminPage } = await import('@/app/(app)/admin/page');
  return renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve(search) }));
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');

beforeEach(() => {
  for (const fn of [h.accuracy, h.inbox, h.imports, h.cvReports, h.warnings, h.reviewSet]) {
    fn.mockReset();
  }
  h.tournaments.mockReset();
  h.redirect.mockClear();
  h.accuracy.mockResolvedValue({
    weighted: 91,
    unweighted: 90,
    n: 1,
    bands: { good: 1, check: 0, rescrape: 0 },
    checked: 0,
    failingByCheck: [],
    stale: 0,
    tournaments: 1,
    openQuestions: [],
  });
  h.inbox.mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pages: 1,
    counts: { check: 0, report: 0, import: 0, parser: 0 },
  });
  h.imports.mockResolvedValue(importList);
  h.cvReports.mockResolvedValue({ rows: [], total: 0, page: 1, pages: 1, status: 'open' });
  h.warnings.mockResolvedValue([]);
  h.reviewSet.mockResolvedValue([]);
  h.tournaments.mockResolvedValue(listed(epoch));
});

describe('/admin shell', () => {
  it('shows the summary line and the seven tabs, in order, under one h1', async () => {
    const out = await render();
    expect(text(out)).toContain(
      'Needs you 7 · Accuracy 91 (Good 915 · Check 414 · Re-scrape 55) · Imports to review 3 · Queue 12',
    );
    const labels = [...out.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Inbox',
      'Tournaments',
      'Imports',
      'Reports',
      'Parser',
      'Review set',
      'Tools',
    ]);
    expect(out.match(/<h1[ >]/g)).toHaveLength(1);
    // Every figure links to its tab.
    expect(out).toContain('href="/admin?tab=imports"');
    expect(out).toContain('href="/admin?tab=tournaments"');
  });

  it('opens on the Inbox, and an unknown tab falls back to it', async () => {
    for (const search of [{}, { tab: 'nonsense' }]) {
      const out = await render(search);
      expect(out).toMatch(/aria-selected="true"[^>]*>Inbox</);
    }
  });

  it('?tab=imports reads and renders only the Imports panel', async () => {
    const out = await render({ tab: 'imports' });
    expect(out).toMatch(/aria-selected="true"[^>]*>Imports</);
    expect(out).toMatch(/<h2[^>]*>Failed imports<\/h2>/);
    expect(out).not.toContain('Data accuracy');
    expect(out).not.toContain('Flagged for review');
    expect(h.imports).toHaveBeenCalled();
    expect(out).toContain('Export errors');
    expect(h.accuracy).not.toHaveBeenCalled();
    expect(h.inbox).not.toHaveBeenCalled();
    expect(h.cvReports).not.toHaveBeenCalled();
    expect(h.warnings).not.toHaveBeenCalled();
    expect(h.reviewSet).not.toHaveBeenCalled();
  });

  it('keeps a failed read to its own panel, saying so', async () => {
    h.imports.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await render({ tab: 'imports' });
    expect(out).toContain('Couldn&#x27;t load');
    expect(out).toMatch(/role="tab"/);
    spy.mockRestore();
  });
});

describe('/admin Tools and Tournaments tabs', () => {
  it('Tools holds the lookup, the links, Export errors, Re-ingest all with its counts, and a closed Danger zone', async () => {
    const out = await render({ tab: 'tools' });
    expect(out).toMatch(/<form[^>]*action="\/api\/admin\/lookup\/search"/);
    for (const href of ['/cv/verify', '/cv/tags', '/admin/tags']) {
      expect(out).toContain(`href="${href}"`);
    }
    // Export errors moved to the Imports tab, with the data it dumps.
    expect(out).not.toContain('Export errors');
    expect(text(out)).toContain('Discovered URLs 40');
    expect(text(out)).toContain('Locked URLs 40');
    expect(out).toContain('Re-ingest all');
    const details = out.match(
      /<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>[\s\S]*?<\/summary>/,
    );
    expect(details?.[0]).toContain('Danger zone');
    const body = out.slice(out.indexOf('Danger zone'));
    expect(body).toContain('Clear data');
    expect(body).toContain('Full wipe');
    // The old tiles are gone.
    expect(out).not.toContain('Current state');
    expect(out).not.toContain('Scrape health');
  });

  it('puts the list and its filters in the Tournaments tab and reads nothing else', async () => {
    const out = await render({ tab: 'tournaments' });
    expect(out).toMatch(/<h2[^>]*>Tournaments in the database<\/h2>/);
    expect(out).toContain('role="group"');
    expect(out).not.toContain('Data accuracy');
    expect(h.inbox).not.toHaveBeenCalled();
    expect(h.imports).not.toHaveBeenCalled();
  });

  it('never renders 1970, whichever tab shows a re-scrape marker', async () => {
    for (const tab of ['inbox', 'tournaments', 'imports', 'reports', 'parser', 'review', 'tools']) {
      expect(await render({ tab })).not.toContain('1970');
    }
    expect(await render({ tab: 'imports', imports: 'covered' })).toContain('Re-scrape queued');
  });
});

describe('/admin/tournaments redirect', () => {
  async function go(search: Record<string, string>): Promise<string> {
    const { default: Page } = await import('@/app/(app)/admin/tournaments/page');
    await expect(Page({ searchParams: Promise.resolve(search) })).rejects.toThrow('NEXT_REDIRECT');
    return h.redirect.mock.calls.at(-1)![0];
  }

  it('sends the old address into its tab, keeping the search and page', async () => {
    expect(await go({ q: 'oxford', page: '2' })).toBe('/admin?tab=tournaments&q=oxford&page=2');
    expect(await go({})).toBe('/admin?tab=tournaments');
  });

  it('never carries a private key into the new address', async () => {
    const to = await go({ q: 'https://oxiv.calicotab.com/oxiv2025/privateurls/k3yS3cr3t/' });
    expect(to).not.toContain('k3yS3cr3t');
    expect(to).toContain('tab=tournaments');
  });
});
