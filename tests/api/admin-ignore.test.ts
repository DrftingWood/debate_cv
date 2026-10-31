import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminMock = vi.fn();
const captureException = vi.fn();
const updateMany = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/db', () => ({ prisma: { tournament: { updateMany } } }));

const { POST } = await import('@/app/api/admin/tournaments/[id]/ignore/route');

const call = (id: string, body: unknown) =>
  POST(new Request('http://x/ignore', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  captureException.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('POST /api/admin/tournaments/[id]/ignore', () => {
  it('rejects non-admins and writes nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    expect((await call('7', { ignored: true })).status).toBe(403);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('sets the state asked for, not a toggle', async () => {
    const res = await call('7', { ignored: true });
    expect(await res.json()).toEqual({ ignored: true });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 7n }, data: { ignored: true } });
    await call('7', { ignored: false });
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 7n }, data: { ignored: false } });
  });

  it('answers 404 for a tournament that is not stored', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect((await call('7', { ignored: true })).status).toBe(404);
  });

  it.each([
    ['0x10', { ignored: true }],
    ['7', {}],
    ['7', { ignored: 'yes' }],
    ['7', { ignored: true, name: 'x' }],
  ])('refuses a malformed request %s %j', async (id, body) => {
    expect((await call(id, body)).status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers a code only when the write throws, and reports it', async () => {
    updateMany.mockRejectedValue(new Error('secret'));
    const res = await call('7', { ignored: true });
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
