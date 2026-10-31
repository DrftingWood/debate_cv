import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminMock = vi.fn();
const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const refreshOldParser = vi.fn();
const refreshTournament = vi.fn();
vi.mock('@/lib/admin/oldParserFill', () => ({ refreshOldParser, refreshTournament }));

const { POST } = await import('@/app/api/admin/old-parser/route');

const call = (body: unknown) =>
  POST(
    new Request('http://x/api/admin/old-parser', { method: 'POST', body: JSON.stringify(body) }),
  );

beforeEach(() => {
  refreshTournament.mockReset();
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  captureException.mockReset();
  refreshOldParser.mockReset().mockResolvedValue({ refreshed: 5, failed: 1, left: 30, next: '88' });
});

describe('POST /api/admin/old-parser', () => {
  it('rejects non-admins and does nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await call({ refresh: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(refreshOldParser).not.toHaveBeenCalled();
  });

  it('maps a signed-out caller to 401', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    expect((await call({ refresh: true })).status).toBe(401);
  });

  it('runs one bounded batch from the top, with a deadline', async () => {
    const res = await call({ refresh: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refreshed: 5, failed: 1, left: 30, next: '88' });
    const [after, opts] = refreshOldParser.mock.calls[0]!;
    expect(after).toBeNull();
    expect(opts.deadline).toBeGreaterThan(Date.now());
    expect(opts.deadline).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('continues from the cursor it is given', async () => {
    await call({ refresh: true, after: '88' });
    expect(refreshOldParser.mock.calls[0]![0]).toBe(88n);
  });

  it.each([
    {},
    { refresh: false },
    { refresh: true, after: '0x10' },
    { refresh: true, after: '1'.repeat(19) },
    { refresh: true, tournamentId: '5' },
    { tournamentId: '0x10' },
    { tournamentId: '5', after: '1' },
  ])('refuses a malformed body %j', async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(refreshOldParser).not.toHaveBeenCalled();
  });

  it('runs the same refresh for one tournament (the Fix) and answers its result', async () => {
    refreshTournament.mockResolvedValue('refreshed');
    const res = await call({ tournamentId: '5' });
    expect(await res.json()).toEqual({ result: 'refreshed' });
    expect(refreshTournament.mock.calls[0]![0]).toBe(5n);
    expect(refreshOldParser).not.toHaveBeenCalled();
  });

  it('answers a code only when the batch throws, and reports it', async () => {
    refreshOldParser.mockRejectedValue(new Error('secret detail'));
    const res = await call({ refresh: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
