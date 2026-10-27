import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const extractMock = vi.fn();
vi.mock('@/lib/gmail/run', () => ({ extractAllFromGmail: (...a: unknown[]) => extractMock(...a) }));
vi.mock('@/lib/gmail/client', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue({}),
  revokeAndForgetGmailToken: vi.fn(),
}));
const enqueueMock = vi.fn();
vi.mock('@/lib/queue', () => ({ enqueueUrl: (...a: unknown[]) => enqueueMock(...a) }));
const notifyMock = vi.fn();
vi.mock('@/lib/notifications/write', () => ({
  writeNotification: (...a: unknown[]) => notifyMock(...a),
}));

const { POST } = await import('@/app/api/ingest/gmail/full/route');
const { claimFullScan, fullScanAvailableAt, releaseFullScan, FULL_SCAN_WINDOW_MS } =
  await import('@/lib/gmail/fullScan');

const DAY = FULL_SCAN_WINDOW_MS;

/** A tiny in-memory RateLimit table behind the prisma mock. */
function fakeRateLimitTable() {
  const rows = new Map<string, { windowStart: Date; count: number }>();
  prismaMock.rateLimit.findUnique.mockImplementation(
    async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
  );
  prismaMock.rateLimit.create.mockImplementation(
    async ({ data }: { data: { key: string; windowStart: Date; count: number } }) => {
      if (rows.has(data.key)) throw new Error('unique');
      rows.set(data.key, { windowStart: data.windowStart, count: data.count });
    },
  );
  prismaMock.rateLimit.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: { key: string; windowStart: Date };
      data: { windowStart: Date; count: number };
    }) => {
      const row = rows.get(where.key);
      if (!row || row.windowStart.getTime() !== where.windowStart.getTime()) return { count: 0 };
      rows.set(where.key, { windowStart: data.windowStart, count: data.count });
      return { count: 1 };
    },
  );
  prismaMock.rateLimit.deleteMany.mockImplementation(
    async ({ where }: { where: { key: string } }) => {
      rows.delete(where.key);
      return { count: 1 };
    },
  );
  return rows;
}

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
  extractMock.mockReset();
  enqueueMock.mockReset();
  notifyMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('full-scan 24h gate (fake clock)', () => {
  it('allows the first, blocks the second, allows again after 24h', async () => {
    fakeRateLimitTable();
    const t0 = Date.parse('2026-10-27T10:00:00Z');
    expect(await claimFullScan('u1', t0)).toEqual({ allowed: true });

    const second = await claimFullScan('u1', t0 + 3_600_000);
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.availableAt.toISOString()).toBe('2026-10-28T10:00:00.000Z');
      expect(second.retryAfterSec).toBe(23 * 3600);
    }
    expect((await fullScanAvailableAt('u1', t0 + 3_600_000))?.toISOString()).toBe(
      '2026-10-28T10:00:00.000Z',
    );

    // A refused attempt does not push the time back.
    expect((await claimFullScan('u1', t0 + DAY - 1000)).allowed).toBe(false);
    expect(await claimFullScan('u1', t0 + DAY)).toEqual({ allowed: true });
    expect(await fullScanAvailableAt('u1', t0 + DAY + 1)).not.toBeNull();
  });

  it('is per user, and a released claim can be taken again', async () => {
    fakeRateLimitTable();
    const t0 = 1_800_000_000_000;
    await claimFullScan('u1', t0);
    expect((await claimFullScan('u2', t0)).allowed).toBe(true);
    await releaseFullScan('u1');
    expect((await claimFullScan('u1', t0 + 1000)).allowed).toBe(true);
  });
});

describe('POST /api/ingest/gmail/full', () => {
  const url = (n: string) => ({
    url: `https://t.calicotab.com/x/privateurls/${n}/`,
    host: 't.calicotab.com',
    tournamentSlug: 'x',
    token: n,
    subject: 's',
    messageId: `m-${n}`,
    messageDate: '2026-01-01T00:00:00Z',
  });

  it('returns 401 when unauthenticated', () => expectUnauthorized(() => POST()));

  it('scans without an `after` bound, writes and queues only new URLs, notifies for new only, then 429s with availableAt', async () => {
    fakeRateLimitTable();
    authMock.mockResolvedValue(fakeSession('u1'));
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1, windowStart: new Date() }]);
    prismaMock.gmailToken.findUnique.mockResolvedValue({ userId: 'u1' });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { url: url('old').url, messageId: 'm-old' },
    ]);
    extractMock.mockResolvedValue({
      scanned: 3,
      total: 2,
      perHost: {},
      perTournament: {},
      truncated: false,
      urls: [url('old'), url('new')],
    });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      scanned: 3,
      found: 1,
      truncated: false,
      perHost: {},
      perTournament: {},
    });

    const opts = extractMock.mock.calls[0]![1] as Record<string, unknown>;
    expect('after' in opts).toBe(false);
    expect(opts.max).toBeGreaterThan(500);
    expect((opts.skipMessageIds as Set<string>).has('m-old')).toBe(true);
    expect(opts.maxFetch).toBeDefined();
    expect(opts.deadline).toBeDefined();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith('u1', url('new').url);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]![0]).toMatchObject({
      kind: 'new_urls_found',
      title: 'Found 1 new URL',
    });

    const again = await POST();
    expect(again.status).toBe(429);
    const body = await readJson<{
      error: string;
      availableAt: string;
      retryAfter: number;
      reason: string;
    }>(again);
    expect(body.error).toBe('rate_limited');
    expect(Number.isNaN(Date.parse(body.availableAt))).toBe(false);
    expect(body.retryAfter).toBeGreaterThan(23 * 3600);
    expect(body.reason).toContain('once every 24 hours');
    expect(again.headers.get('Retry-After')).toBe(String(body.retryAfter));
    expect(extractMock).toHaveBeenCalledTimes(1);
  });

  it('posts no notification and queues nothing when every URL was already known', async () => {
    fakeRateLimitTable();
    authMock.mockResolvedValue(fakeSession('u1'));
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1, windowStart: new Date() }]);
    prismaMock.gmailToken.findUnique.mockResolvedValue({ userId: 'u1' });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([{ url: url('a').url, messageId: null }]);
    extractMock.mockResolvedValue({
      scanned: 1,
      total: 1,
      perHost: {},
      perTournament: {},
      truncated: false,
      urls: [url('a')],
    });
    const res = await POST();
    expect((await readJson<{ found: number }>(res)).found).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('handles a revoked token like the incremental path (401 token_invalid) and gives the day back', async () => {
    const rows = fakeRateLimitTable();
    authMock.mockResolvedValue(fakeSession('u1'));
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1, windowStart: new Date() }]);
    prismaMock.gmailToken.findUnique.mockResolvedValue({ userId: 'u1' });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    extractMock.mockRejectedValue(
      Object.assign(new Error('invalid_grant'), { message: 'invalid_grant' }),
    );
    const res = await POST();
    expect(res.status).toBe(401);
    expect((await readJson<{ error: string }>(res)).error).toBe('token_invalid');
    expect(rows.size).toBe(0);
  });
});
