import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScrapeHealth } from '@/lib/admin/scrapeHealth';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Server-render checks for the admin overview (Task 8 of the partial-scrapes
// plan): the scrape-health section and the failed-imports table, with data
// and without. The page's data sources are mocked; the client components
// render their first paint through react-dom/server.

const health = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => ({ id: 'admin' })) }));
vi.mock('@/lib/admin/scrapeHealth', () => ({
  getScrapeHealth: vi.fn(async () => health.current),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    tournament: { count: vi.fn(async () => 12), findMany: vi.fn(async () => []) },
    discoveredUrl: { count: vi.fn(async () => 40) },
    ingestJob: { count: vi.fn(async () => 3) },
    parserRun: { findMany: vi.fn(async () => []) },
    cvErrorReport: { findMany: vi.fn(async () => []) },
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

const full: ScrapeHealth = {
  tracked: 9,
  partlyLoaded: 2,
  failingPieces: 4,
  retriesDue: 1,
  stuck: 2,
  failingByKind: [
    { kind: 'round', count: 3 },
    { kind: 'speaker', count: 1 },
  ],
  partlyLoadedTournaments: [
    {
      id: BigInt(5),
      name: 'Oxford IV 2025',
      lastAttemptAt: minutes(-90),
      failed: [
        {
          kind: 'round',
          key: '3',
          label: 'R3',
          httpStatus: 503,
          attempts: 5,
          nextRetryAt: null,
        },
        {
          kind: 'speaker',
          key: '',
          label: 'Speaker tab',
          httpStatus: null,
          attempts: 5,
          nextRetryAt: null,
        },
      ],
    },
    {
      id: BigInt(8),
      name: 'Cambridge Open',
      lastAttemptAt: minutes(-10),
      failed: [
        {
          kind: 'round',
          key: '1',
          label: 'R1',
          httpStatus: 500,
          attempts: 1,
          nextRetryAt: minutes(30),
        },
      ],
    },
  ],
  failedJobs: [
    {
      id: 'job-1',
      url: 'https://oxiv.calicotab.com/oxiv2025/privateurls/abc123/',
      userEmail: 'maya@example.com',
      attempts: 3,
      lastError: 'HTTP 503 Service Unavailable at fetchPage (lib/calicotab/fetch.ts:88)',
      finishedAt: minutes(-120),
    },
  ],
};

const empty: ScrapeHealth = {
  tracked: 0,
  partlyLoaded: 0,
  failingPieces: 0,
  retriesDue: 0,
  stuck: 0,
  failingByKind: [],
  partlyLoadedTournaments: [],
  failedJobs: [],
};

async function renderPage(data: ScrapeHealth): Promise<string> {
  health.current = data;
  const { default: AdminPage } = await import('@/app/(app)/admin/page');
  return renderToStaticMarkup(await AdminPage());
}

describe('admin overview', () => {
  beforeEach(() => {
    health.current = null;
  });

  it('shows scrape health with a row per partly loaded tournament', async () => {
    const out = await renderPage(full);
    expect(out).toMatch(/<h2[^>]*>Scrape health<\/h2>/);
    expect(out).toContain('Partly loaded tournaments');
    expect(out).toContain('href="/admin/tournaments/5"');
    expect(out).toMatch(/<button[^>]*aria-label="Retry failed[^"]*Oxford IV 2025[^"]*"/);
    expect(out).toContain('Needs you');
    // The bars name the kinds in words and the total states its sample.
    expect(out).toContain('Speaker tab');
    expect(out).toContain('4 failing pieces across 2 tournaments');
    expect(out).toMatch(
      /Retries due now: <[^>]+>1<.*Waiting for an admin \(5 failures\): <[^>]+>2</,
    );
  });

  it('turns the current state into tiles, with partly loaded and failed jobs', async () => {
    const out = await renderPage(full);
    expect(out).toContain('Partly loaded');
    expect(out).toContain('of 9 tracked');
    expect(out).toContain('Failed jobs');
  });

  it('lists failed imports in words, never the raw error', async () => {
    const out = await renderPage(full);
    expect(out).toMatch(/<h2[^>]*>Failed imports<\/h2>/);
    expect(out).toContain('oxiv.calicotab.com/oxiv2025/…');
    expect(out).not.toContain('abc123');
    expect(out).toContain('The tab site had a problem on its side.');
    expect(out).not.toContain('fetch.ts');
    expect(out).toContain('Retry selected');
    expect(out).toMatch(/Retry all 3/);
    expect(out).toMatch(/aria-label="Select [^"]*oxiv\.calicotab\.com[^"]*"/);
  });

  it('states both empty states when nothing is failing', async () => {
    const out = await renderPage(empty);
    expect(out).toContain('Every tracked tournament loaded in full');
    expect(out).toContain('No failed imports');
    expect(out).not.toContain('Retry selected');
  });
});
