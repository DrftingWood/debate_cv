import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { POST } = await import('@/app/api/ingest/lock/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('POST /api/ingest/lock', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(
      jsonRequest('/api/ingest/lock', {
        body: { url: 'https://x.calicotab.com/u/aaa/', locked: true },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects malformed body', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const res = await POST(
      jsonRequest('/api/ingest/lock', { body: { url: 'not-a-url', locked: true } }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the URL does not belong to the user', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(
      jsonRequest('/api/ingest/lock', {
        body: { url: 'https://x.calicotab.com/u/aaa/', locked: true },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('locks a URL and clears any pending IngestJob rows for it', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ingestJob.deleteMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      jsonRequest('/api/ingest/lock', {
        body: { url: 'https://x.calicotab.com/u/aaa/', locked: true },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ locked: boolean; updated: number }>(res);
    expect(data).toEqual({ locked: true, updated: 1 });
    expect(prismaMock.ingestJob.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user-1',
        status: 'pending',
      }),
    });
  });

  it('unlocks a URL without touching IngestJob rows', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      jsonRequest('/api/ingest/lock', {
        body: { url: 'https://x.calicotab.com/u/aaa/', locked: false },
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.ingestJob.deleteMany).not.toHaveBeenCalled();
  });
});
