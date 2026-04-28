import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
vi.mock('@/lib/calicotab/ingest', async () => {
  const actual: typeof import('@/lib/calicotab/ingest') =
    await vi.importActual('@/lib/calicotab/ingest');
  return {
    ...actual,
    ingestPrivateUrl: vi.fn(),
    // Keep the real isDeadlockError so the route's deadlock-detection
    // path runs against actual classification logic, not a stub.
  };
});

const { POST } = await import('@/app/api/ingest/url/route');
const { ingestPrivateUrl } = await import('@/lib/calicotab/ingest');

const URL_OK = 'https://x.calicotab.com/test-tournament/privateurls/abcdef12/';

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
  vi.mocked(ingestPrivateUrl).mockReset();
});

describe('POST /api/ingest/url', () => {
  it('returns 401 when unauthenticated', () =>
    expectUnauthorized(() => POST(jsonRequest('/api/ingest/url', { body: { url: URL_OK } }))));

  it('rejects malformed body', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const res = await POST(jsonRequest('/api/ingest/url', { body: { url: 'not-a-url' } }));
    expect(res.status).toBe(400);
  });

  it('rejects URLs that do not match the private-URL pattern', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const res = await POST(
      jsonRequest('/api/ingest/url', { body: { url: 'https://example.com/random' } }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('not_a_private_url');
  });

  it('reschedules deadlock-class failures instead of marking them failed (audit #8)', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    vi.mocked(ingestPrivateUrl).mockRejectedValue(
      Object.assign(new Error('write conflict'), { code: 'P2034' }),
    );
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(jsonRequest('/api/ingest/url', { body: { url: URL_OK } }));
    expect(res.status).toBe(503);
    const data = await readJson<{ error: string; hint: string }>(res);
    expect(data.error).toBe('transient_deadlock');
    // Job should be rescheduled (status=pending), not failed.
    expect(prismaMock.ingestJob.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', url: { in: expect.any(Array) } },
      data: expect.objectContaining({
        status: 'pending',
        startedAt: null,
        scheduledAt: expect.any(Date),
      }),
    });
  });

  it('marks the job failed for non-deadlock errors', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    vi.mocked(ingestPrivateUrl).mockRejectedValue(new Error('parse failed'));
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(jsonRequest('/api/ingest/url', { body: { url: URL_OK } }));
    expect(res.status).toBe(500);
    expect(prismaMock.ingestJob.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', url: { in: expect.any(Array) } },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });
});
