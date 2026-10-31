import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { POST } = await import('@/app/api/admin/jobs/retry/route');

const call = (body: unknown) =>
  POST(
    new Request('http://x/api/admin/jobs/retry', { method: 'POST', body: JSON.stringify(body) }),
  );

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  resetPrismaMock();
  prismaMock.ingestJob.findMany.mockResolvedValue([
    { id: 'a', userId: 'u1', url: 'https://x/a' },
    { id: 'b', userId: 'u1', url: 'https://x/b' },
    { id: 'c', userId: 'u2', url: 'https://x/c' },
  ]);
  prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
  prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 3 });
});

describe('POST /api/admin/jobs/retry', () => {
  it('rejects non-admins and requeues nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    const res = await call({ all: true });
    expect(res.status).toBe(401);
    expect(prismaMock.ingestJob.updateMany).not.toHaveBeenCalled();
  });

  it('{all:true} resets failed or abandoned jobs, at most 200 a call', async () => {
    const res = await call({ all: true });
    expect(await res.json()).toEqual({ requeued: 3, skippedLocked: 0 });
    expect(prismaMock.ingestJob.findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['failed', 'abandoned'] },
    });
    expect(prismaMock.ingestJob.findMany.mock.calls[0][0].take).toBe(200);
    const arg = prismaMock.ingestJob.updateMany.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(arg.data.scheduledAt).toBeInstanceOf(Date);
  });

  it('answers a database error as JSON, not an unhandled 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.ingestJob.findMany.mockRejectedValue(new Error('db down'));
    const res = await call({ all: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });

  it('{ids} narrows to those jobs but still only failed/abandoned ones', async () => {
    await call({ ids: ['a', 'b'] });
    expect(prismaMock.ingestJob.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['a', 'b'] },
      status: { in: ['failed', 'abandoned'] },
    });
  });

  it('does not requeue a job for a locked URL and counts it as skipped', async () => {
    prismaMock.discoveredUrl.findMany.mockResolvedValue([{ userId: 'u1', url: 'https://x/b' }]);
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 2 });
    const res = await call({ all: true });
    expect(await res.json()).toEqual({ requeued: 2, skippedLocked: 1 });
    expect(prismaMock.ingestJob.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['a', 'c'] });
  });

  it('rejects empty, oversized and malformed bodies with 400', async () => {
    expect((await call({ ids: [] })).status).toBe(400);
    expect((await call({ ids: Array.from({ length: 201 }, (_, i) => String(i)) })).status).toBe(
      400,
    );
    expect((await call({ ids: ['x'.repeat(65)] })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ all: false })).status).toBe(400);
    expect(prismaMock.ingestJob.updateMany).not.toHaveBeenCalled();
  });
});
