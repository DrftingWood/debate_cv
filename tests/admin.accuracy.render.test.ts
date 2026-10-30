import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccuracyOverview } from '@/lib/admin/accuracy';
import type { ScrapeHealth } from '@/lib/admin/scrapeHealth';

// The components use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Server-render checks for the admin overview's "Data accuracy" section, and
// for the owner's rule (2026-10-31) that every tournament URL the admin shows
// is a link to the PUBLIC tab: the fixtures below carry private URLs on
// purpose, and no href may keep one.

const h = vi.hoisted(() => ({ accuracy: null as unknown, health: null as unknown }));

vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => ({ id: 'admin' })) }));
vi.mock('@/lib/admin/accuracy', () => ({ getAccuracyOverview: vi.fn(async () => h.accuracy) }));
vi.mock('@/lib/admin/scrapeHealth', () => ({ getScrapeHealth: vi.fn(async () => h.health) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    tournament: { count: vi.fn(async () => 12), findMany: vi.fn(async () => []) },
    discoveredUrl: { count: vi.fn(async () => 40) },
    ingestJob: { count: vi.fn(async () => 1) },
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
const PRIVATE = 'https://oxiv.calicotab.com/oxiv2025/privateurls/abc123/';

const health: ScrapeHealth = {
  tracked: 2,
  withheld: 0,
  partlyLoaded: 1,
  failingPieces: 1,
  retriesDue: 0,
  stuck: 0,
  failingByKind: [{ kind: 'round', count: 1 }],
  partlyLoadedTournaments: [
    {
      id: BigInt(5),
      name: 'Oxford IV 2025',
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      scrapedAt: new Date(NOW - 7_200_000),
      lastAttemptAt: new Date(NOW - 60_000),
      failed: [
        {
          kind: 'round',
          key: '3',
          label: 'R3',
          httpStatus: 500,
          attempts: 1,
          nextRetryAt: new Date(NOW + 60_000),
        },
      ],
    },
  ],
  failedJobs: [
    {
      id: 'job-1',
      url: PRIVATE,
      userEmail: 'maya@example.com',
      attempts: 3,
      lastError: 'HTTP 503',
      finishedAt: new Date(NOW - 60_000),
      stored: null,
      tab: { state: 'missing', tournamentId: null, errors: [] },
    },
  ],
};

const round = (key: string) => ({
  kind: 'round' as const,
  key,
  label: `R${key}`,
  url: `https://oxiv.calicotab.com/oxiv2025/results/round/${key}/`,
});

const overview: AccuracyOverview = {
  weighted: 81,
  unweighted: 74,
  n: 40,
  onCvs: 12,
  bands: { good: 25, check: 10, rescrape: 5 },
  failingByCheck: [{ code: 'rounds_complete', label: 'Rounds complete', count: 4 }],
  stale: 3,
  tournaments: 43,
  lowest: [
    {
      id: '5',
      name: 'Oxford IV 2025',
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      scrapedAt: new Date(NOW - 7_200_000),
      score: 42,
      band: 'rescrape',
      failed: ['champion', 'rounds_complete', 'panels', 'motions', 'partners'].map((code) => ({
        code: code as 'champion',
        label: code,
      })),
      suggested: [round('3'), round('4'), { kind: 'team', key: '', label: 'Team tab', url: null }],
      usersAffected: 2,
      computedAt: new Date(NOW - 3_600_000),
    },
    {
      id: '8',
      name: 'Cambridge Open',
      tabUrl: null,
      scrapedAt: null,
      score: 88,
      band: 'check',
      failed: [],
      suggested: [],
      usersAffected: 0,
      computedAt: new Date(NOW - 60_000),
    },
  ],
  openQuestions: [
    {
      code: 'no_open_bracket_champion',
      title: 'Champion when a tab has no Open bracket',
      rule: 'When a tab has no Open bracket (for example schools Senior/Junior or APDA Varsity/Novice), the bracket with the most outround teams names the champion.',
      status: 'On hold — owner to decide',
      count: 1,
      tournaments: [
        {
          id: '9',
          name: 'Schools Cup',
          tabUrl: 'https://s.calicotab.com/sc/',
          scrapedAt: new Date(NOW - 7_200_000),
        },
      ],
    },
  ],
};

const empty: AccuracyOverview = {
  ...overview,
  weighted: null,
  unweighted: null,
  n: 0,
  onCvs: 0,
  bands: { good: 0, check: 0, rescrape: 0 },
  failingByCheck: [],
  lowest: [],
  openQuestions: [],
};

async function renderPage(accuracy: AccuracyOverview): Promise<string> {
  h.accuracy = accuracy;
  h.health = health;
  const { default: AdminPage } = await import('@/app/(app)/admin/page');
  return renderToStaticMarkup(await AdminPage());
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);

beforeEach(() => {
  h.accuracy = null;
});

describe('Data accuracy section', () => {
  it('shows the score tiles with their samples', async () => {
    const out = await renderPage(overview);
    expect(out).toMatch(/<h2[^>]*>Data accuracy<\/h2>/);
    expect(out).toContain('Accuracy score');
    expect(out).toContain('across 40 tournaments · 12 on users&#x27; CVs');
    expect(out).toContain('25 / 10 / 5');
    expect(out).toContain('Not audited in 24 h');
    expect(out).toContain('of 43 tournaments');
    expect(out).toContain('Tournaments failing each check');
    expect(out).toContain('Out of 40 audited tournaments');
  });

  it('lists the lowest scores, linked, with a named re-scrape action', async () => {
    const out = await renderPage(overview);
    expect(out).toContain('href="/admin/tournaments/5"');
    expect(out).toMatch(/Re-scrape<\/span>42/);
    // Four badges, then the rest as a count.
    expect(out).toContain('+1');
    expect(out).toMatch(
      /<button[^>]*aria-label="Re-scrape suggested \(3\) for Oxford IV 2025"[^>]*>.*Re-scrape suggested \(3\)/,
    );
    expect(out).toMatch(/aria-label="Re-scrape all failed for Cambridge Open"/);
    expect(out).toContain('None failing');
    // Cambridge Open has no public address: a word, not an unlinked "Tab".
    expect(out).toMatch(/<td[^>]*><span class="text-ink-soft">None<\/span><\/td>/);
  });

  it('links the tab and each suggested page in a new tab', async () => {
    const out = await renderPage(overview);
    expect(out).toMatch(
      /<a href="https:\/\/oxiv\.calicotab\.com\/oxiv2025\/" target="_blank" rel="noopener noreferrer" aria-label="Tab of Oxford IV 2025, opens in a new tab"[^>]*>Tab<span aria-hidden="true"> ↗<\/span><\/a>/,
    );
    expect(out).toContain('href="https://oxiv.calicotab.com/oxiv2025/results/round/3/"');
    expect(out).toContain('aria-label="R3 of Oxford IV 2025, opens in a new tab"');
    // No public URL: words, no link.
    expect(out).not.toContain('Team tab of Oxford IV 2025');
  });

  it('shows each open question with what it decided', async () => {
    const out = await renderPage(overview);
    expect(out).toContain('Open questions');
    expect(out).toContain('Champion when a tab has no Open bracket');
    expect(out).toContain('APDA Varsity/Novice');
    expect(out).toContain('On hold — owner to decide');
    expect(out).toMatch(/Decided <span[^>]*>1<\/span> of 40 audited tournaments/);
    expect(out).toContain('href="/admin/tournaments/9"');
    expect(out).toContain('aria-label="Tab of Schools Cup, opens in a new tab"');
    // Open questions sit after the tiles and before the chart.
    const at = (s: string) => out.indexOf(s);
    expect(at('Not audited in 24 h')).toBeLessThan(at('Open questions'));
    expect(at('Open questions')).toBeLessThan(at('Tournaments failing each check'));
  });

  it('an open question that decided nothing says so', async () => {
    const q = { ...overview.openQuestions[0]!, count: 0, tournaments: [] };
    const out = await renderPage({ ...overview, openQuestions: [q] });
    expect(out).toContain('It has not decided any of the 40 audited tournaments yet.');
  });

  it('nothing audited: the empty state, with Audit now as its action', async () => {
    const out = await renderPage(empty);
    expect(out).toContain('No tournaments audited yet');
    expect(out.match(/>Audit now</g)).toHaveLength(1);
    expect(out).not.toContain('Accuracy score');
  });
});

describe('Data accuracy: in the database (Task 5b)', () => {
  // Task 5b: the accuracy table and the open-questions list say "Stored"
  // with the scrape time. Their names already link the tournament's page,
  // so the cell adds no second "Open" link.
  it('says each listed tournament is stored, and when it was scraped', async () => {
    const out = await renderPage(overview);
    const section = out.slice(out.indexOf('id="data-accuracy"'));
    expect(section).toMatch(/<th[^>]*>In database<\/th>/);
    expect(section.match(/>Stored</g)!.length).toBeGreaterThanOrEqual(3);
    expect(section).toContain('2 h ago');
    expect(section).not.toMatch(/aria-label="Open /);
  });
});

describe('tournament URLs are public links (owner, 2026-10-31)', () => {
  it('no href on the overview carries a private key', async () => {
    const out = await renderPage(overview);
    const all = hrefs(out);
    expect(all.length).toBeGreaterThan(5);
    expect(all.filter((u) => u.toLowerCase().includes('privateurls'))).toEqual([]);
  });

  it('failed imports and partly loaded rows link the public tab', async () => {
    const out = await renderPage(overview);
    // Failed imports: the short URL is the link text.
    expect(out).toMatch(
      /<a href="https:\/\/oxiv\.calicotab\.com\/oxiv2025\/" target="_blank" rel="noopener noreferrer" aria-label="oxiv\.calicotab\.com\/oxiv2025\/…, opens in a new tab"/,
    );
    // Partly loaded: a Tab link beside the name.
    expect(out.match(/aria-label="Tab of Oxford IV 2025, opens in a new tab"/g)).toHaveLength(2);
    expect(out).not.toContain('abc123');
  });
});

describe('action states', () => {
  it('Re-scrape suggested says what it is doing while it runs (UX-22)', async () => {
    const { RescrapeSuggestedView } = await import('@/components/admin/RescrapeSuggestedButton');
    const props = { tournamentName: 'Oxford IV', suggested: [round('3')], error: null };
    const busy = renderToStaticMarkup(
      React.createElement(RescrapeSuggestedView, { ...props, pending: true, onRun: () => {} }),
    );
    expect(busy).toContain('Re-scraping…');
    expect(busy).toMatch(
      /role="status"[^>]*>Re-scraping the suggested pages of Oxford IV\. This can take up to a minute\.</,
    );
    const failed = renderToStaticMarkup(
      React.createElement(RescrapeSuggestedView, {
        ...props,
        pending: false,
        error: 'Another scrape of this tournament is running. Try again in a minute.',
        onRun: () => {},
      }),
    );
    expect(failed).toMatch(/role="alert"[^>]*>Another scrape/);
  });

  it('Audit now has a status region from the first render (UX-19)', async () => {
    const { AuditNowView, auditedTitle } = await import('@/components/admin/AuditNowButton');
    const idle = renderToStaticMarkup(
      React.createElement(AuditNowView, { pending: false, error: null, onRun: () => {} }),
    );
    expect(idle).toMatch(/role="status"[^>]*><\/p>/);
    const busy = renderToStaticMarkup(
      React.createElement(AuditNowView, { pending: true, error: null, onRun: () => {} }),
    );
    expect(busy).toContain('Auditing…');
    expect(auditedTitle(1)).toBe('Audited 1 tournament');
    expect(auditedTitle(12)).toBe('Audited 12 tournaments');
  });
});
