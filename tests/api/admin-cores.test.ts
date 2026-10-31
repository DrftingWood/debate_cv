import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminMock = vi.fn();
const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const fillMissingCores = vi.fn();
vi.mock('@/lib/admin/coreFill', () => ({ fillMissingCores }));

const { POST } = await import('@/app/api/admin/cores/route');

const call = (body: unknown) =>
  POST(new Request('http://x/api/admin/cores', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  captureException.mockReset();
  fillMissingCores
    .mockReset()
    .mockResolvedValue({ found: 5, none: 2, failed: 1, left: 30, next: '88' });
});

describe('POST /api/admin/cores', () => {
  it('rejects non-admins and does nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await call({ fillMissing: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fillMissingCores).not.toHaveBeenCalled();
  });

  it('maps a signed-out caller to 401', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    expect((await call({ fillMissing: true })).status).toBe(401);
  });

  it('runs one bounded batch from the top, with a deadline', async () => {
    const res = await call({ fillMissing: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: 5, none: 2, failed: 1, left: 30, next: '88' });
    const [after, opts] = fillMissingCores.mock.calls[0]!;
    expect(after).toBeNull();
    expect(opts.deadline).toBeGreaterThan(Date.now());
    expect(opts.deadline).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('continues from the cursor it is given', async () => {
    await call({ fillMissing: true, after: '88' });
    expect(fillMissingCores.mock.calls[0]![0]).toBe(88n);
  });

  it.each([
    {},
    { fillMissing: false },
    { fillMissing: true, after: '0x10' },
    { fillMissing: true, after: '1'.repeat(19) },
    { fillMissing: true, tournamentId: '5' },
    { tournamentId: '5' },
  ])('refuses a malformed body %j', async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(fillMissingCores).not.toHaveBeenCalled();
  });

  it('answers a code only when the batch throws, and reports it', async () => {
    fillMissingCores.mockRejectedValue(new Error('secret detail'));
    const res = await call({ fillMissing: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
