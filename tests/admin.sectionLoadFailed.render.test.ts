import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScrapeHealth } from '@/lib/admin/scrapeHealth';

(globalThis as { React?: typeof React }).React = React;

// PR #266 final review M3: /admin reads every section at once, and one
// ledger's failed read used to reject the whole Promise.all, a 500 for the
// operator tools too. Each ledger now says in words that it could not load.

vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => 'admin@example.com') }));
vi.mock('@/lib/admin/accuracy', () => ({
  getAccuracyOverview: vi.fn(async () => {
    throw new Error('accuracy down');
  }),
}));
vi.mock('@/lib/admin/scrapeHealth', () => ({ getScrapeHealth: vi.fn(async () => health) }));
vi.mock('@/lib/admin/reviewSet', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/reviewSet')>()),
  loadReviewSet: vi.fn(async () => {
    throw new Error('review set down');
  }),
}));
vi.mock('@/lib/admin/cvReports', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/cvReports')>()),
  listCvReports: vi.fn(async () => {
    throw new Error('reports down');
  }),
}));
vi.mock('@/lib/admin/parserWarnings', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/parserWarnings')>()),
  listParserWarnings: vi.fn(async () => {
    throw new Error('warnings down');
  }),
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
    discoveredUrl: { count: vi.fn(async () => 40) },
    ingestJob: { count: vi.fn(async () => 0) },
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

const health: ScrapeHealth = {
  tracked: 0,
  withheld: 0,
  partlyLoaded: 0,
  failingPieces: 0,
  retriesDue: 0,
  stuck: 0,
  failingByKind: [],
  partlyLoadedTournaments: [],
  failedJobs: [],
};

describe('/admin when a ledger cannot be read', () => {
  it('still renders, each failed section saying so, and logs each failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: AdminPage } = await import('@/app/(app)/admin/page');
    let html = '';
    for (const tab of ['tournaments', 'imports', 'reports', 'parser', 'review', 'tools']) {
      html += renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ tab }) }));
    }
    expect(html).toContain('Admin: operator tools');
    expect(html).toContain('Couldn&#x27;t load the review set');
    expect(html).toContain('Couldn&#x27;t load the CV reports');
    expect(html).toContain('Couldn&#x27;t load the parser warnings');
    expect(html).toContain('Couldn&#x27;t load the filters');
    expect(html).toContain('Flagged for review');
    expect(html).toContain('CV error reports');
    expect(html).toContain('Recent parser warnings');
    const logged = log.mock.calls.map((c) => String(c[0]));
    for (const what of ['review set', 'CV reports', 'parser warnings', 'accuracy overview']) {
      expect(logged).toContain(`admin: ${what} failed to load`);
    }
    log.mockRestore();
  });
});
