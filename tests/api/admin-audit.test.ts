import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const runAudit = vi.fn();
const auditStale = vi.fn();
vi.mock('@/lib/audit/run', () => ({ runAudit, auditStale }));

const { POST } = await import('@/app/api/admin/audit/route');

const call = (body: unknown) =>
  POST(new Request('http://x/api/admin/audit', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  runAudit.mockReset().mockResolvedValue(1);
  auditStale.mockReset().mockResolvedValue(12);
});

describe('POST /api/admin/audit', () => {
  it('rejects non-admins and audits nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await call({ stale: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(auditStale).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
  });

  it('maps a signed-out caller to 401', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    const res = await call({ stale: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('{ stale: true } audits one bounded batch of 100 with a deadline', async () => {
    const before = Date.now();
    const res = await call({ stale: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ audited: 12 });
    const { limit, deadline } = auditStale.mock.calls[0]![0] as { limit: number; deadline: number };
    expect(limit).toBe(100);
    expect(deadline).toBeGreaterThanOrEqual(before + 50_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 55_000);
  });

  it('{ tournamentId } audits that one tournament', async () => {
    const res = await call({ tournamentId: '42' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ audited: 1 });
    expect(runAudit).toHaveBeenCalledWith([42n]);
  });

  it('a bad id or body is 400 bad_request', async () => {
    for (const body of [
      { tournamentId: '0x10' },
      { tournamentId: ' 5 ' },
      { tournamentId: '1234567890123456789' },
      { tournamentId: 5 },
      { stale: false },
      {},
      null,
    ]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    }
    expect(runAudit).not.toHaveBeenCalled();
    expect(auditStale).not.toHaveBeenCalled();
  });

  it('an unexpected failure is 500 server_error, not a raw message', async () => {
    runAudit.mockRejectedValue(new Error('connection reset at 10.0.0.1'));
    const res = await call({ tournamentId: '42' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });
});
