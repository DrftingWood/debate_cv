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

const { GET } = await import('@/app/api/cv/status/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('GET /api/cv/status', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => GET()));

  it('returns zero counts for a brand-new user with no URLs', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.ingestJob.count.mockResolvedValue(0);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    const res = await GET();
    const data = await readJson<{ pendingCount: number; unmatchedCount: number }>(res);
    expect(data).toEqual({ pendingCount: 0, unmatchedCount: 0 });
    // No second-stage participant query when there's nothing to match.
    expect(prismaMock.tournamentParticipant.findMany).not.toHaveBeenCalled();
  });

  it('reports pendingCount from queued + running jobs combined', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.ingestJob.count.mockResolvedValue(7);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    const res = await GET();
    const data = await readJson<{ pendingCount: number; unmatchedCount: number }>(res);
    expect(data.pendingCount).toBe(7);
    expect(prismaMock.ingestJob.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: { in: ['pending', 'running'] },
      },
    });
  });

  it('counts unmatched tournaments — ingested but no claimed-Person participant', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.ingestJob.count.mockResolvedValue(0);
    // 3 ingested tournaments
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { tournamentId: BigInt(1) },
      { tournamentId: BigInt(2) },
      { tournamentId: BigInt(3) },
    ]);
    // user is matched to participant rows for tournaments 1 and 3 only
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([
      { tournamentId: BigInt(1) },
      { tournamentId: BigInt(3) },
    ]);
    const res = await GET();
    const data = await readJson<{ pendingCount: number; unmatchedCount: number }>(res);
    // tournament 2 ingested but unmatched
    expect(data.unmatchedCount).toBe(1);
  });

  it('scopes both queries to the current user', async () => {
    authMock.mockResolvedValue(fakeSession('user-7'));
    prismaMock.ingestJob.count.mockResolvedValue(0);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    await GET();
    expect(prismaMock.ingestJob.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-7' }) }),
    );
    expect(prismaMock.discoveredUrl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-7' }) }),
    );
  });
});
