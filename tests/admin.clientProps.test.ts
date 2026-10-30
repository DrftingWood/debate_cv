import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review of 2ec9cde: a prop handed from a server component to a 'use client'
// one is serialised into the page's RSC payload whatever the client renders,
// so sanitising only the href (TabLink) is not enough. These build the exact
// row arrays the server passes to FailedJobsTable, PartlyLoadedTable,
// AccuracyTable and PieceGrid, from stored data full of private URLs, and
// check the serialised props carry no private key.

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;

const h = vi.hoisted(() => ({
  db: {
    tournament: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    tournamentAudit: { findMany: vi.fn(), findUnique: vi.fn() },
    scrapePiece: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    ingestJob: { findMany: vi.fn() },
    discoveredUrl: { findMany: vi.fn() },
    reviewFlag: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const { getScrapeHealth, getTournamentPieces } = await import('@/lib/admin/scrapeHealth');
const { getAccuracyOverview } = await import('@/lib/admin/accuracy');
const { toPartlyLoadedRows } = await import('@/components/admin/ScrapeHealthSection');
const { toFailedJobRows } = await import('@/components/admin/FailedImportsSection');
const { toAccuracyRows } = await import('@/components/admin/AccuracySection');
const { getTournamentAccuracy } = await import('@/lib/admin/tournamentAccuracy');
const { toPieceCard } = await import('@/lib/admin/pieceGrid');
const { shortUrl } = await import('@/lib/utils/shortUrl');
const { asLookupUrl, searchBoxValue } = await import('@/lib/admin/tabAddress');
const { loadReviewSet, reviewSetCsv, toExportRecord } = await import('@/lib/admin/reviewSet');
const { toReviewRows } = await import('@/components/admin/ReviewSetSection');

const NOW = new Date('2026-10-31T12:00:00Z');

function expectNoKey(props: unknown) {
  const json = JSON.stringify(props);
  expect(json.toLowerCase()).not.toContain('privateurls');
  expect(json).not.toContain(KEY);
}

beforeEach(() => {
  for (const model of Object.values(h.db)) for (const fn of Object.values(model)) fn.mockReset();
  h.db.tournament.count.mockResolvedValue(1);
  h.db.tournament.findMany.mockResolvedValue([
    { id: 1n, name: 'Oxford IV', sourceUrlRaw: PRIVATE, scrapedAt: NOW },
  ]);
  h.db.discoveredUrl.findMany.mockResolvedValue([]);
  h.db.tournament.findUnique.mockResolvedValue({
    id: 1n,
    name: 'Oxford IV',
    sourceUrlRaw: PRIVATE,
  });
  h.db.scrapePiece.count.mockResolvedValue(1);
  h.db.scrapePiece.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
    by[0] === 'kind'
      ? [{ kind: 'round', _count: { _all: 1 } }]
      : [{ tournamentId: 1n, _max: { lastAttemptAt: NOW } }],
  );
  const piece = {
    tournamentId: 1n,
    kind: 'round',
    key: '3',
    label: 'R3',
    status: 'failed',
    httpStatus: 500,
    attempts: 2,
    loadedAt: null,
    lastAttemptAt: NOW,
    nextRetryAt: null,
    lastError: `HTTP 500 at ${PRIVATE}results/round/3/`,
  };
  h.db.scrapePiece.findMany.mockResolvedValue([piece]);
  h.db.ingestJob.findMany.mockResolvedValue([
    {
      id: 'j1',
      url: PRIVATE,
      attempts: 3,
      lastError: `fetch failed for ${PRIVATE}`,
      finishedAt: NOW,
      user: { email: 'a@b.c' },
    },
  ]);
});

describe('props crossing into client components carry no private key', () => {
  it('PartlyLoadedTable rows', async () => {
    const health = await getScrapeHealth();
    const rows = toPartlyLoadedRows(health, NOW);
    expect(rows[0]!.tabUrl).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expectNoKey(rows);
  });

  it('FailedJobsTable rows', async () => {
    const health = await getScrapeHealth();
    const rows = toFailedJobRows(health.failedJobs, NOW);
    expect(rows[0]!.href).toBe('https://oxiv.calicotab.com/oxiv2025/');
    // Task 5b: the "In database" cell found its tournament by host and slug.
    expect(rows[0]!.stored).toMatchObject({ id: '1' });
    expectNoKey(rows);
  });

  it('AccuracyTable rows, with their suggested piece links', async () => {
    h.db.tournamentAudit.findMany.mockResolvedValue([
      {
        tournamentId: 1n,
        score: 10,
        usersAffected: 0,
        computedAt: NOW,
        checks: [
          {
            code: 'rounds_complete',
            status: 'fail',
            detail: '',
            pieces: [{ kind: 'round', key: '3', label: 'R3', url: `${PRIVATE}results/round/3/` }],
          },
        ],
      },
    ]);
    const o = await getAccuracyOverview();
    const rows = toAccuracyRows(o.lowest, NOW);
    expect(rows[0]!.suggested[0]!.url).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expectNoKey(rows);
    expectNoKey(o.openQuestions);
  });

  it('PieceGrid cards, with their Open on tab links', async () => {
    const data = await getTournamentPieces(1n);
    const cards = [...data!.tabs, ...data!.rounds].map((p) =>
      toPieceCard({ ...p, url: `${PRIVATE}results/round/3/` }, NOW),
    );
    expect(cards[0]!.url).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expectNoKey(cards);
  });
});

describe('the In database cell carries no private key (Task 5b)', () => {
  it('FailedJobsTable rows linked through DiscoveredUrl.tournamentId', async () => {
    h.db.discoveredUrl.findMany.mockResolvedValue([
      {
        userId: 'u1',
        url: PRIVATE,
        tournament: { id: 9n, name: 'Linked', scrapedAt: NOW },
      },
    ]);
    h.db.ingestJob.findMany.mockResolvedValue([
      {
        id: 'j1',
        url: PRIVATE,
        userId: 'u1',
        attempts: 1,
        lastError: null,
        finishedAt: NOW,
        user: { email: null },
      },
    ]);
    const health = await getScrapeHealth();
    const rows = toFailedJobRows(health.failedJobs, NOW);
    expect(rows[0]!.stored).toMatchObject({ id: '9' });
    expectNoKey(rows);
  });
});

describe('the accuracy checks panel carries no private key', () => {
  it('AccuracyChecks audit and the suggested pieces', async () => {
    h.db.tournamentAudit.findUnique.mockResolvedValue({
      score: 10,
      computedAt: NOW,
      checks: [
        {
          code: 'rounds_complete',
          status: 'fail',
          detail: 'Round 3 is missing.',
          pieces: [{ kind: 'round', key: '3', label: 'R3', url: `${PRIVATE}results/round/3/` }],
        },
      ],
    });
    const audit = await getTournamentAccuracy(1n);
    expect(audit!.suggested[0]!.url).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expectNoKey(audit);
  });
});

describe('the tournament search box', () => {
  it('re-renders a name or a public URL, and only the public form of a private one', () => {
    expect(searchBoxValue('Oxford')).toBe('Oxford');
    expect(searchBoxValue('https://oxiv.calicotab.com/oxiv2025/tab/team/')).toBe(
      'https://oxiv.calicotab.com/oxiv2025/tab/team/',
    );
    expect(searchBoxValue(PRIVATE)).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expect(searchBoxValue(`junk /PrivateUrls/${KEY}`)).toBe('');
    expect(searchBoxValue(undefined)).toBe('');
    expect(searchBoxValue(`oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`)).toBe(
      'https://oxiv.calicotab.com/oxiv2025/',
    );
  });

  // Review of a00d4c0: private text without its scheme is a URL, never a
  // name search that would put the key in an address.
  it('treats any text with a /privateurls/ segment as a URL', () => {
    expect(asLookupUrl(`oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`)).toBe(
      `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`,
    );
    expect(asLookupUrl(PRIVATE)).toBe(PRIVATE);
    expect(asLookupUrl(`junk /PrivateUrls/${KEY}`)).not.toBeNull();
    expect(asLookupUrl('Oxford IV')).toBeNull();
  });
});

describe('shortUrl', () => {
  it('never echoes a link it cannot read', () => {
    expect(shortUrl(`not a url /privateurls/${KEY}/`)).toBe('Unreadable link');
    expect(shortUrl(PRIVATE)).toBe('oxiv.calicotab.com/oxiv2025/…');
  });
});

describe('the Tab column and the review set carry no private key (Task 5c)', () => {
  it('FailedJobsTable rows: the Tab cell lists failed pages in words', async () => {
    const health = await getScrapeHealth();
    const rows = toFailedJobRows(health.failedJobs, NOW, new Map([['j1', 'high']]));
    expect(rows[0]!.tab).toEqual({
      state: 'partial',
      tournamentId: '1',
      errors: ['R3: HTTP 500 Internal Server Error'],
    });
    expect(rows[0]!.flag).toEqual({ priority: 'high' });
    expectNoKey(rows);
  });

  it('ReviewSetTable rows and both exports, even with a key pasted into a comment', async () => {
    h.db.reviewFlag.findMany.mockResolvedValue([
      {
        id: 1n,
        source: 'import',
        sourceId: 'j1',
        // A row written before the address was made public must still not leak.
        url: PRIVATE,
        tournamentId: 1n,
        tournament: { id: 1n, name: 'Oxford IV' },
        priority: 'high',
        comment: `see ${PRIVATE}results/round/3/`,
        status: 'open',
        createdBy: 'admin@example.com',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    h.db.ingestJob.findMany.mockResolvedValue([
      { id: 'j1', url: PRIVATE, userId: 'u1', attempts: 3, lastError: `fetch failed ${PRIVATE}` },
    ]);
    const flags = await loadReviewSet();
    expect(flags[0]!.url).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expectNoKey(toReviewRows(flags, NOW));
    expectNoKey(flags.map(toExportRecord));
    expectNoKey(reviewSetCsv(flags));
  });
});
