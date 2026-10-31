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
  checked: 2,
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
  checked: 0,
  failingByCheck: [],
  lowest: [],
  openQuestions: [],
};

async function renderPage(accuracy: AccuracyOverview): Promise<string> {
  h.accuracy = accuracy;
  h.health = health;
  return renderTabs(['tournaments', 'imports']);
}

/**
 * The tabs this suite reads, rendered one after another: each tab is its own
 * request now, and these checks are about the sections, not the strip.
 */
async function renderTabs(tabs: string[]): Promise<string> {
  const { default: AdminPage } = await import('@/app/(app)/admin/page');
  const out: string[] = [];
  for (const tab of tabs) {
    out.push(renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ tab }) })));
  }
  return out.join('\n');
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);

beforeEach(() => {
  h.accuracy = null;
});

/** The page's visible words: tags gone, spaces folded. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function renderTournaments(
  accuracy: AccuracyOverview | null,
  search: Record<string, string> = {},
): Promise<string> {
  h.accuracy = accuracy;
  const { default: AdminPage } = await import('@/app/(app)/admin/page');
  return renderToStaticMarkup(
    await AdminPage({ searchParams: Promise.resolve({ tab: 'tournaments', ...search }) }),
  );
}

describe('Tournaments tab filter chips (R5)', () => {
  it('counts each chip with the overview’s own figures', async () => {
    const out = words(await renderTournaments(overview));
    expect(out).toContain('Good 25');
    expect(out).toContain('Check 10');
    expect(out).toContain('Re-scrape 5');
    expect(out).toContain('Rounds complete 4');
    expect(out).toContain('Checked by an admin 2');
    expect(out).toContain('Open question: champion when no Open bracket 1');
    expect(out).not.toContain('Data accuracy');
  });

  it('has one chip per failing check, most-failed first', async () => {
    const failing = [
      { code: 'champion' as const, label: 'Champion', count: 9 },
      { code: 'panels' as const, label: 'Panels', count: 3 },
      { code: 'motions' as const, label: 'Motions', count: 1 },
    ];
    const out = words(await renderTournaments({ ...overview, failingByCheck: failing }));
    const at = (s: string) => out.indexOf(s);
    expect(at('Champion 9')).toBeGreaterThan(-1);
    expect(at('Champion 9')).toBeLessThan(at('Panels 3'));
    expect(at('Panels 3')).toBeLessThan(at('Motions 1'));
  });

  it('links each chip to its filter, keeping the search and dropping the page', async () => {
    const out = await renderTournaments(overview, { q: 'oxford', page: '2' });
    const all = hrefs(out);
    expect(all).toContain('/admin?tab=tournaments&amp;q=oxford&amp;check=rounds_complete');
    expect(all).toContain('/admin?tab=tournaments&amp;q=oxford&amp;band=rescrape');
    expect(all).toContain('/admin?tab=tournaments&amp;q=oxford&amp;checked=1');
    expect(all).toContain(
      '/admin?tab=tournaments&amp;q=oxford&amp;question=no_open_bracket_champion',
    );
  });

  it('marks the chosen chips and links them to clear themselves', async () => {
    const out = await renderTournaments(overview, { check: 'rounds_complete', band: 'rescrape' });
    expect(out).toMatch(/<a[^>]*aria-current="true"[^>]*href="[^"]*"[^>]*>Re-scrape/);
    // Choosing a chosen chip again removes just that filter.
    expect(hrefs(out)).toContain('/admin?tab=tournaments&amp;band=rescrape');
    expect(hrefs(out)).toContain('/admin?tab=tournaments&amp;check=rounds_complete');
    expect(out.match(/aria-current="true"/g)).toHaveLength(2);
  });

  it('keeps the open question to one line, with its rule in a details', async () => {
    const out = await renderTournaments(overview);
    expect(out).toMatch(
      /<details[^>]*>.*APDA Varsity\/Novice.*On hold — owner to decide.*<\/details>/,
    );
    expect(out).not.toMatch(/<h[2-4][^>]*>Open questions</);
  });

  it('nothing audited: says there is nothing to filter by, with Audit now', async () => {
    const out = await renderTournaments(empty);
    expect(words(out)).toContain('No tournament is audited yet, so there is nothing to filter by');
    expect(out.match(/>Audit now</g)).toBeNull();
  });

  it('a failed overview read says the filters did not load; the list still shows', async () => {
    const out = words(await renderTournaments(null));
    expect(out).toContain('the filters');
    expect(out).toContain('No tournaments stored yet');
  });
});

describe('tournament URLs are public links (owner, 2026-10-31)', () => {
  it('no href on the overview carries a private key', async () => {
    const out = await renderPage(overview);
    const all = hrefs(out);
    expect(all.length).toBeGreaterThan(5);
    expect(all.filter((u) => u.toLowerCase().includes('privateurls'))).toEqual([]);
  });

  it('failed imports and accuracy rows link the public tab', async () => {
    const out = await renderPage(overview);
    // Failed imports: the short URL is the link text.
    expect(out).toMatch(
      /<a href="https:\/\/oxiv\.calicotab\.com\/oxiv2025\/" target="_blank" rel="noopener noreferrer" aria-label="oxiv\.calicotab\.com\/oxiv2025\/…, opens in a new tab"/,
    );
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
