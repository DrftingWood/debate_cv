import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { POST } = await import('@/app/api/admin/reingest-all/route');

beforeEach(() => {
  requireAdminMock.mockReset();
  resetPrismaMock();
  requireAdminMock.mockResolvedValue('admin@example.com');
});

describe('POST /api/admin/reingest-all', () => {
  it('rejects non-admins and queues nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await POST();
    expect(res.status).toBe(403);
    expect(prismaMock.ingestJob.upsert).not.toHaveBeenCalled();
    expect(prismaMock.tournament.updateMany).not.toHaveBeenCalled();
  });

  it('queues every unlocked URL', async () => {
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { userId: 'u1', url: 'https://a.calicotab.com/a/privateurls/x/', tournamentId: 1n },
      { userId: 'u2', url: 'https://b.calicotab.com/b/privateurls/y/', tournamentId: 2n },
    ]);
    prismaMock.discoveredUrl.count.mockResolvedValue(3);
    prismaMock.ingestJob.upsert.mockResolvedValue({});
    prismaMock.tournament.updateMany.mockResolvedValue({ count: 2 });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: 2, skippedLocked: 3 });
    expect(prismaMock.ingestJob.upsert).toHaveBeenCalledTimes(2);
  });

  it('marks the tournaments stale so the queued ingests really re-fetch', async () => {
    // An ingest is served from cache while the stored tournament is fresh
    // (30 days) and at the current parser version, so without this the job
    // finishes in about a second and re-fetches nothing: "Re-ingest all"
    // would be a no-op for every tournament already ingested.
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { userId: 'u1', url: 'https://a.calicotab.com/a/privateurls/x/', tournamentId: 1n },
      { userId: 'u2', url: 'https://a.calicotab.com/a/privateurls/z/', tournamentId: 1n },
      { userId: 'u3', url: 'https://c.calicotab.com/c/privateurls/w/', tournamentId: null },
      { userId: 'u4', url: 'https://b.calicotab.com/b/privateurls/y/', tournamentId: 2n },
    ]);
    prismaMock.discoveredUrl.count.mockResolvedValue(0);
    prismaMock.ingestJob.upsert.mockResolvedValue({});
    prismaMock.tournament.updateMany.mockResolvedValue({ count: 2 });
    await POST();

    expect(prismaMock.tournament.updateMany).toHaveBeenCalledTimes(1);
    const arg = prismaMock.tournament.updateMany.mock.calls[0][0] as {
      where: { id: { in: bigint[] } };
      data: { scrapedAt: Date };
    };
    // Each tournament once, none for a URL that has not been ingested yet.
    expect([...arg.where.id.in].sort()).toEqual([1n, 2n]);
    expect(arg.data.scrapedAt.getTime()).toBe(0);
  });

  it('does not touch tournaments when there is nothing to queue', async () => {
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    prismaMock.discoveredUrl.count.mockResolvedValue(0);
    const res = await POST();
    expect(await res.json()).toEqual({ queued: 0, skippedLocked: 0 });
    expect(prismaMock.tournament.updateMany).not.toHaveBeenCalled();
  });
});
