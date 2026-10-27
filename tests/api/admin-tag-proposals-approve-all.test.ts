import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { POST } = await import('@/app/api/admin/tag-proposals/approve-all/route');

function post(body: unknown = {}) {
  return POST(
    new Request('http://localhost/api/admin/tag-proposals/approve-all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  requireAdminMock.mockReset();
  resetPrismaMock();
  requireAdminMock.mockResolvedValue('admin@example.com');
});

describe('POST /api/admin/tag-proposals/approve-all', () => {
  it('rejects non-admins with the thrown status and writes nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(prismaMock.tagProposal.findMany).not.toHaveBeenCalled();
    expect(prismaMock.motion.update).not.toHaveBeenCalled();
  });

  it('writes each pending proposal through to its canonical column and marks it approved', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([
      {
        id: 'p1',
        kind: 'region',
        tournamentId: 1n,
        motionId: null,
        value: 'Europe',
        status: 'pending',
      },
      {
        id: 'p2',
        kind: 'motion_type',
        tournamentId: 1n,
        motionId: 11n,
        value: 'THW',
        status: 'pending',
      },
      {
        id: 'p3',
        kind: 'motion_topic',
        tournamentId: 1n,
        motionId: 11n,
        value: 'Education',
        status: 'pending',
      },
    ]);
    prismaMock.tagProposal.update.mockResolvedValue({});
    prismaMock.tagProposal.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.tournament.update.mockResolvedValue({});
    prismaMock.motion.update.mockResolvedValue({});

    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approved: 3 });

    expect(prismaMock.tournament.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { region: 'Europe' },
    });
    expect(prismaMock.motion.update).toHaveBeenCalledWith({
      where: { id: 11n },
      data: { motionType: 'THW' },
    });
    expect(prismaMock.motion.update).toHaveBeenCalledWith({
      where: { id: 11n },
      data: { topic: 'Education' },
    });
    expect(prismaMock.tagProposal.update).toHaveBeenCalledTimes(3);
  });

  it('can be limited to one kind', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([]);
    const res = await post({ kind: 'region' });
    expect(res.status).toBe(200);
    expect(prismaMock.tagProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending', kind: 'region' } }),
    );
    expect(await res.json()).toEqual({ approved: 0 });
  });

  it('rejects an unknown kind', async () => {
    const res = await post({ kind: 'nonsense' });
    expect(res.status).toBe(400);
  });
});
