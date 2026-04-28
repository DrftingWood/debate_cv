import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  expectMalformedBody,
  jsonRequest,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { POST } = await import('@/app/api/ingest/clear/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('POST /api/ingest/clear', () => {
  it('returns 401 when unauthenticated', () =>
    expectUnauthorized(() =>
      POST(
        jsonRequest('/api/ingest/clear', {
          body: { url: 'https://x.calicotab.com/u/aaa/' },
        }),
      ),
    ));

  it('rejects malformed body', () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    return expectMalformedBody(() =>
      POST(jsonRequest('/api/ingest/clear', { body: { url: 'not-a-url' } })),
    );
  });

  it('resets the IngestJob to pending and unmarks DiscoveredUrl as ingested', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      jsonRequest('/api/ingest/clear', {
        body: { url: 'https://x.calicotab.com/u/aaa/' },
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.ingestJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'user-1' }),
      data: expect.objectContaining({
        status: 'pending',
        attempts: 0,
        lastError: null,
      }),
    });
    expect(prismaMock.discoveredUrl.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'user-1' }),
      data: expect.objectContaining({
        ingestedAt: null,
        tournamentId: null,
      }),
    });
  });
});
