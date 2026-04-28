import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { POST } = await import('@/app/api/ingest/retry-failed/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('POST /api/ingest/retry-failed', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => POST()));

  it('returns {retried: 0, skipped: 0} when no failed jobs exist', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.ingestJob.findMany.mockResolvedValue([]);
    const res = await POST();
    const data = await readJson<{ retried: number; skipped: number }>(res);
    expect(data).toEqual({ retried: 0, skipped: 0 });
  });

  it('skips permanently-dead URLs (HTTP 404 in lastError) but retries the rest', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.ingestJob.findMany.mockResolvedValue([
      { url: 'https://x.calicotab.com/u/aaa/', lastError: 'fetch landing → HTTP 500: ...' },
      { url: 'https://x.calicotab.com/u/bbb/', lastError: 'fetch landing → HTTP 404: ...' },
      { url: 'https://x.calicotab.com/u/ccc/', lastError: 'parse failed' },
    ]);
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 2 });

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await readJson<{ retried: number; skipped: number }>(res);
    expect(data.retried).toBe(2);
    expect(data.skipped).toBe(1);

    // The reset should target only the recoverable URLs (skip the 404).
    const txCall = prismaMock.$transaction.mock.calls[0]![0] as unknown[];
    expect(txCall).toHaveLength(2);
    expect(prismaMock.ingestJob.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', url: { in: ['https://x.calicotab.com/u/aaa/', 'https://x.calicotab.com/u/ccc/'] } },
      data: expect.objectContaining({ status: 'pending' }),
    });
    expect(prismaMock.discoveredUrl.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', url: { in: ['https://x.calicotab.com/u/aaa/', 'https://x.calicotab.com/u/ccc/'] } },
      data: expect.objectContaining({ ingestedAt: null }),
    });
  });
});
