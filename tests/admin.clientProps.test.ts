import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review of 2ec9cde: a prop handed from a server component to a 'use client'
// one is serialised into the page's RSC payload whatever the client renders,
// so sanitising only the href (TabLink) is not enough. These build the exact
// row arrays the server passes to ImportGroupsTable,
// the accuracy overview and PieceGrid, from stored data full of private URLs, and
// check the serialised props carry no private key.

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;

const h = vi.hoisted(() => ({
  db: {
    tournament: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    tournamentAudit: { findMany: vi.fn(), findUnique: vi.fn() },
    scrapePiece: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    ingestJob: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    discoveredUrl: { findMany: vi.fn() },
    reviewFlag: { findMany: vi.fn() },
    cvErrorReport: { findMany: vi.fn(), count: vi.fn() },
    parserRun: { findMany: vi.fn() },
    teamResult: { groupBy: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));
// No admin has marked anything: the reads below are about what crosses to the client.
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  marksFor: async () => new Map(),
}));

const { getTournamentPieces } = await import('@/lib/admin/scrapeHealth');
const { getAccuracyOverview } = await import('@/lib/admin/accuracy');
const { listImports } = await import('@/lib/admin/importsList');
const { toImportRows } = await import('@/components/admin/tabs/ImportsTab');
const { getTournamentAccuracy } = await import('@/lib/admin/tournamentAccuracy');
const { toPieceCard } = await import('@/lib/admin/pieceGrid');
const { shortUrl } = await import('@/lib/utils/shortUrl');
const { asLookupUrl, hasPrivateKeyPath, searchBoxValue } = await import('@/lib/admin/tabAddress');
const { loadReviewSet, reviewSetCsv, toExportRecord } = await import('@/lib/admin/reviewSet');
const { toReviewRows } = await import('@/components/admin/ReviewSetSection');
const { listCvReports } = await import('@/lib/admin/cvReports');
const { toCvReportRows } = await import('@/components/admin/CvReportsSection');
const { listParser } = await import('@/lib/admin/parserList');
const { toWarningRows } = await import('@/components/admin/ParserWarningsSection');

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
      userId: 'u1',
      attempts: 3,
      lastError: `fetch failed for ${PRIVATE}`,
      finishedAt: NOW,
      scheduledAt: NOW,
    },
  ]);
  h.db.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.c' }]);
});

describe('props crossing into client components carry no private key', () => {
  it('ImportGroupsTable rows', async () => {
    const list = await listImports({ filter: 'all', page: 1 });
    const rows = toImportRows(list.rows, NOW);
    expect(rows[0]!.tabUrl).toBe('https://oxiv.calicotab.com/oxiv2025/');
    // Task 5b: the stored tournament was found by host and slug.
    expect(rows[0]!.stored).toMatchObject({ id: '1' });
    expectNoKey(rows);
  });

  it('accuracy overview', async () => {
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
    expectNoKey(o);
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
  it('ImportGroupsTable rows linked through DiscoveredUrl.tournamentId', async () => {
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
        scheduledAt: NOW,
      },
    ]);
    const list = await listImports({ filter: 'covered', page: 1 });
    const rows = toImportRows(list.rows, NOW);
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

  // Final review of PR #265: a bare `privateurls/KEY`, with no host before
  // it, is still someone's key.
  it('catches a bare privateurls/KEY with no host', () => {
    expect(hasPrivateKeyPath(`privateurls/${KEY}`)).toBe(true);
    expect(hasPrivateKeyPath(`PrivateUrls/${KEY}/`)).toBe(true);
    expect(hasPrivateKeyPath('myprivateurls/x')).toBe(false);
    expect(asLookupUrl(`privateurls/${KEY}`)).not.toBeNull();
    expect(searchBoxValue(`privateurls/${KEY}`)).toBe('');
  });
});

describe('shortUrl', () => {
  it('never echoes a link it cannot read', () => {
    expect(shortUrl(`not a url /privateurls/${KEY}/`)).toBe('Unreadable link');
    expect(shortUrl(PRIVATE)).toBe('oxiv.calicotab.com/oxiv2025/…');
  });
});

describe('the Tab column and the review set carry no private key (Task 5c)', () => {
  it('ImportGroupsTable rows: the Tab cell lists failed pages in words', async () => {
    const list = await listImports({ filter: 'covered', page: 1 });
    const rows = toImportRows(list.rows, NOW);
    expect(rows[0]!.tab).toEqual({
      state: 'partial',
      tournamentId: '1',
      errors: ['R3: HTTP 500 Internal Server Error'],
    });
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

/** A CV report and a parser run full of private URLs (Task 5d). */
function seedReportsAndWarnings() {
  h.db.cvErrorReport.count.mockResolvedValue(1);
  h.db.cvErrorReport.findMany.mockResolvedValue([
    {
      id: 'r1',
      userId: 'u1',
      tournamentIds: ['1'],
      categories: ['wrong_speaker_rank'],
      comment: `my private link ${PRIVATE}tab/speaker/ and oxiv.calicotab.com/x/privateurls/${KEY}`,
      status: 'open',
      createdAt: NOW,
      resolvedAt: null,
      user: { name: 'Maya', email: 'maya@example.com' },
    },
  ]);
  h.db.tournament.findMany.mockResolvedValue([
    { id: 1n, name: 'Oxford IV', sourceUrlRaw: PRIVATE, prelimRoundCount: 3, scrapedAt: NOW },
  ]);
  h.db.teamResult.groupBy.mockResolvedValue([]);
  h.db.parserRun.findMany.mockResolvedValue([
    {
      parserName: 'parseTabs',
      warnings: [`Bad row — at ${PRIVATE}tab/team/ (privateurls/${KEY})`],
      createdAt: NOW,
      sourceDocument: { url: `${PRIVATE}tab/team/` },
    },
  ]);
}

describe('CV reports and parser warnings carry no private key (Task 5d)', () => {
  beforeEach(seedReportsAndWarnings);

  it('CvReportsTable rows: tab links, suggested pieces and the comment', async () => {
    const list = await listCvReports({ page: 1 });
    const rows = toCvReportRows(list.rows, NOW);
    expect(rows[0]!.tournaments[0]!.tabUrl).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expect(rows[0]!.tournaments[0]!.suggested.length).toBeGreaterThan(0);
    expectNoKey(rows);
  });

  it('ParserWarningsTable rows: matched tournaments, headline and sample', async () => {
    const list = await listParser({ filter: 'problems', page: 1, now: NOW });
    const rows = toWarningRows(list.rows, NOW);
    expect(rows[0]!.tournaments[0]).toMatchObject({ id: '1', name: 'Oxford IV' });
    expectNoKey(rows);
  });

  it('the review set export of a CV report and a parser warning', async () => {
    const flag = (id: bigint, source: string, sourceId: string) => ({
      id,
      source,
      sourceId,
      url: '',
      tournamentId: null,
      tournament: null,
      priority: 'high',
      comment: `see ${PRIVATE}`,
      status: 'open',
      createdBy: 'admin@example.com',
      createdAt: NOW,
      updatedAt: NOW,
    });
    h.db.reviewFlag.findMany.mockResolvedValue([
      flag(1n, 'cv_report', 'r1'),
      flag(2n, 'parser_warning', 'parseTabs|Bad row'),
    ]);
    const flags = await loadReviewSet();
    const records = flags.map(toExportRecord);
    const report = records.find((r) => r.source === 'cv_report')!;
    expect(report.detail).toMatchObject({
      reporter: { name: 'Maya', email: 'maya@example.com' },
      categories: ['Wrong speaker rank'],
      tournaments: [{ id: '1', name: 'Oxford IV' }],
    });
    const warning = records.find((r) => r.source === 'parser_warning')!;
    expect(warning.detail).toMatchObject({ parser: 'parseTabs', headline: 'Bad row', count: 1 });
    expectNoKey(records);
    expectNoKey(reviewSetCsv(flags));
    expectNoKey(toReviewRows(flags, NOW));
  });
});
