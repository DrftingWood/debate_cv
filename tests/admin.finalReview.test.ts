import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// PR #266 final review: a flagged import reads its Tab state the way Failed
// imports does (I1, M2), and nothing an admin hands on carries a private key
// (I2: the CV reports export; M6: a parser warning's flag key).

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => 'admin@example.com') }));

const { loadReviewSet } = await import('@/lib/admin/reviewSet');
const exportRoute = await import('@/app/api/admin/cv-error-reports-export/route');
const reviewSetRoute = await import('@/app/api/admin/review-set/route');

const KEY = 'tw1nK3y';
const TWIN_PRIVATE = `https://twinopen2024.calicotab.com/twin/privateurls/${KEY}/`;
const TWIN_PUBLIC = 'https://twinopen2024.calicotab.com/twin/';
const d = (s: string) => new Date(s);

const flag = (over: Record<string, unknown>) => ({
  id: 1n,
  source: 'import',
  sourceId: 'j1',
  url: TWIN_PUBLIC,
  tournamentId: null,
  tournament: null,
  priority: 'medium',
  comment: 'c',
  status: 'open',
  createdBy: 'admin@example.com',
  createdAt: d('2026-10-30T10:00:00Z'),
  updatedAt: d('2026-10-30T10:00:00Z'),
  ...over,
});

const row = (id: bigint, url: string) => ({
  id,
  name: `Twin Open ${id}`,
  sourceUrlRaw: url,
  scrapedAt: d('2026-10-01'),
});

beforeEach(() => {
  resetPrismaMock();
  prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
  prismaMock.tournament.findMany.mockResolvedValue([]);
  prismaMock.scrapePiece.findMany.mockResolvedValue([]);
  prismaMock.ingestJob.findMany.mockResolvedValue([]);
  prismaMock.cvErrorReport.findMany.mockResolvedValue([]);
  prismaMock.parserRun.findMany.mockResolvedValue([]);
});

describe('a flagged import on an address two stored rows share (I1)', () => {
  it('reads "? Check", as Failed imports does, not "✗ Not loaded"', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([flag({})]);
    prismaMock.ingestJob.findMany.mockResolvedValue([
      { id: 'j1', url: TWIN_PRIVATE, userId: 'u1', attempts: 2, lastError: null },
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      row(1n, `${TWIN_PUBLIC}privateurls/a/`),
      row(2n, `${TWIN_PUBLIC}privateurls/b/`),
    ]);
    const [f] = await loadReviewSet();
    expect(f.tournament).toBeNull();
    expect(f.tab.state).toBe('check');
    expect(f.tab.errors[0]).toContain('2 stored tournaments share this address');
    expect(JSON.stringify(f)).not.toContain(KEY);
  });

  it('reads "? Check" for a tab-site address with no slug to match on', async () => {
    const bare = `https://twinopen2024.calicotab.com/privateurls/${KEY}/`;
    prismaMock.reviewFlag.findMany.mockResolvedValue([
      flag({ url: 'https://twinopen2024.calicotab.com/' }),
    ]);
    prismaMock.ingestJob.findMany.mockResolvedValue([
      { id: 'j1', url: bare, userId: 'u1', attempts: 1, lastError: null },
    ]);
    const [f] = await loadReviewSet();
    expect(f.tab.state).toBe('check');
    expect(f.tab.errors[0]).toContain('names no tournament');
  });

  it('still reads "✗ Not loaded" for an address nothing stored matches', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([flag({})]);
    prismaMock.ingestJob.findMany.mockResolvedValue([
      { id: 'j1', url: TWIN_PRIVATE, userId: 'u1', attempts: 1, lastError: null },
    ]);
    const [f] = await loadReviewSet();
    expect(f.tab.state).toBe('missing');
  });
});

describe('a flagged import whose job is gone (M2)', () => {
  it("matches the flag's public address, so a tournament scraped again reads ✓", async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([flag({ sourceId: 'gone' })]);
    prismaMock.ingestJob.findMany.mockResolvedValue([]);
    prismaMock.tournament.findMany.mockResolvedValue([row(7n, TWIN_PUBLIC)]);
    const [f] = await loadReviewSet();
    expect(f.tournament).toEqual({ id: '7', name: 'Twin Open 7' });
    expect(f.tab).toEqual({ state: 'loaded', tournamentId: '7', errors: [] });
    expect(f.attempts).toBeNull();
  });

  it('reads "? Check" when its address matches two stored rows', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([flag({ sourceId: 'gone' })]);
    prismaMock.tournament.findMany.mockResolvedValue([
      row(1n, `${TWIN_PUBLIC}privateurls/a/`),
      row(2n, `${TWIN_PUBLIC}privateurls/b/`),
    ]);
    const [f] = await loadReviewSet();
    expect(f.tab.state).toBe('check');
  });
});

describe('the admin CV reports export (I2)', () => {
  it('writes a comment with any pasted private URL in its public form', async () => {
    prismaMock.cvErrorReport.findMany.mockResolvedValue([
      {
        id: 'r1',
        createdAt: d('2026-10-30T10:00:00Z'),
        userId: 'u1',
        user: { name: 'Maya', email: 'maya@example.com' },
        tournamentIds: [],
        categories: ['speaks'],
        comment: `R3 is wrong, see ${TWIN_PRIVATE}results/round/3/ and twin/privateurls/${KEY}/`,
        status: 'open',
        resolvedAt: null,
      },
    ]);
    const res = await exportRoute.GET();
    const csv = await res.text();
    expect(csv).toContain(`see ${TWIN_PUBLIC} and`);
    expect(csv.toLowerCase()).not.toContain('privateurls');
    expect(csv).not.toContain(KEY);
  });
});

describe('flagging a parser warning (M6)', () => {
  const post = (sourceId: string) =>
    reviewSetRoute.POST(
      new Request('http://localhost/api/admin/review-set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{ source: 'parser_warning', sourceId }],
          priority: 'low',
          comment: 'look',
        }),
      }),
    );

  it('refuses a key that carries a private URL, and stores nothing', async () => {
    const res = await post(`parseTabs|R3 failed at ${TWIN_PRIVATE}`);
    expect(res.status).toBe(400);
    expect(prismaMock.reviewFlag.createMany).not.toHaveBeenCalled();
    expect(prismaMock.reviewFlag.findMany).not.toHaveBeenCalled();
  });

  it('takes a scrubbed key as it is', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([]);
    prismaMock.reviewFlag.createMany.mockResolvedValue({ count: 1 });
    const res = await post(`parseTabs|R3 failed at ${TWIN_PUBLIC}`);
    expect(res.status).toBe(200);
    expect(prismaMock.reviewFlag.createMany.mock.calls[0][0].data[0].sourceId).toBe(
      `parseTabs|R3 failed at ${TWIN_PUBLIC}`,
    );
  });
});
