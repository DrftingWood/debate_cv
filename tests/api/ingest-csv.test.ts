import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
vi.mock('@/lib/queue', () => ({ enqueueUrl: vi.fn() }));
vi.mock('@/lib/rateLimit', async () => {
  const actual: typeof import('@/lib/rateLimit') = await vi.importActual('@/lib/rateLimit');
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(null) };
});

const { POST } = await import('@/app/api/ingest/csv/route');
const { enqueueUrl } = await import('@/lib/queue');
const { enforceRateLimit, RATE_LIMITS } = await import('@/lib/rateLimit');

const url = (n: number) => `https://t${n}.calicotab.com/slug${n}/privateurls/tok${n}/`;

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
  vi.mocked(enqueueUrl).mockReset();
  vi.mocked(enforceRateLimit).mockClear();
});

describe('POST /api/ingest/csv', () => {
  it('returns 401 when unauthenticated', () =>
    expectUnauthorized(() => POST(jsonRequest('/api/ingest/csv', { body: { csv: url(1) } }))));

  it('queues each usable URL for the signed-in user and reports per line', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const res = await POST(
      jsonRequest('/api/ingest/csv', {
        body: { csv: `${url(1)}\nhttps://example.com/x\n${url(2)}\n${url(1)}\n` },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ queued: number; rows: Array<{ line: number; status: string }> }>(
      res,
    );
    expect(data.queued).toBe(2);
    expect(data.rows.map((r) => r.status)).toEqual(['ok', 'not_a_private_url', 'ok', 'duplicate']);
    expect(vi.mocked(enqueueUrl).mock.calls).toEqual([
      ['user-1', url(1)],
      ['user-1', url(2)],
    ]);
  });

  it('never echoes a URL back in the response', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const res = await POST(jsonRequest('/api/ingest/csv', { body: { csv: url(7) } }));
    expect(JSON.stringify(await readJson(res))).not.toContain('tok7');
  });

  it('is limited per user, five uploads a day', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    await POST(jsonRequest('/api/ingest/csv', { body: { csv: url(1) } }));
    expect(enforceRateLimit).toHaveBeenCalledWith('ingest:csv', 'user-1');
    expect(RATE_LIMITS['ingest:csv']).toEqual({ limit: 5, windowSec: 86400 });
  });

  it('rejects an empty file and a body with no csv', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const empty = await POST(jsonRequest('/api/ingest/csv', { body: { csv: '  \n' } }));
    expect(empty.status).toBe(400);
    expect((await readJson<{ error: string }>(empty)).error).toBe('empty');
    const bad = await POST(jsonRequest('/api/ingest/csv', { body: {} }));
    expect(bad.status).toBe(400);
    expect(enqueueUrl).not.toHaveBeenCalled();
  });
});
