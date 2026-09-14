import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  expectMalformedBody,
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

  it('rejects malformed body', () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    return expectMalformedBody(() =>
      POST(jsonRequest('/api/ingest/url', { body: { url: 'not-a-url' } })),
    );
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

describe('POST /api/ingest/url — SSRF gate', () => {
  beforeEach(() => authMock.mockResolvedValue(fakeSession('user-1')));

  // The route used to gate on PRIVATE_URL_RE.test(), which is an unanchored
  // scanner: every URL below satisfies it because it CONTAINS a private-URL
  // substring, and the server then fetched the attacker's host. Each must
  // be rejected before ingestPrivateUrl is reached.
  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/?x=https://a.calicotab.com/t/privateurls/abc'],
    ['loopback service', 'http://localhost:5432/?u=https://a.calicotab.com/t/privateurls/abc'],
    ['arbitrary external host', 'https://attacker.example/collect?next=https://a.calicotab.com/t/privateurls/abc'],
    ['lookalike domain', 'https://a.calicotab.com.evil.example/t/privateurls/abc'],
    ['embedded credentials', 'https://user:pw@x.calicotab.com/t/privateurls/abc'],
    ['explicit port', 'https://x.calicotab.com:8080/t/privateurls/abc'],
  ])('rejects %s without fetching', async (_name, url) => {
    const res = await POST(jsonRequest('/api/ingest/url', { body: { url } }));
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('not_a_private_url');
    expect(vi.mocked(ingestPrivateUrl)).not.toHaveBeenCalled();
  });

  it('still accepts a genuine private URL', async () => {
    vi.mocked(ingestPrivateUrl).mockResolvedValue({
      tournamentId: 1n,
      fingerprint: 'fp',
      cached: false,
      claimedPersonId: null,
      claimedPersonName: null,
      totalTeams: 0,
      totalParticipants: 0,
      warnings: [],
    } as unknown as Awaited<ReturnType<typeof ingestPrivateUrl>>);
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);

    const res = await POST(jsonRequest('/api/ingest/url', { body: { url: URL_OK } }));
    expect(res.status).toBe(200);
    expect(vi.mocked(ingestPrivateUrl)).toHaveBeenCalledTimes(1);
  });
});
