import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

// Task R6 (carry-over from R1): on the Reports tab "Mark checked" means
// acknowledged. The route moves an open report to acknowledged and stores the
// mark with the fingerprint of the status the report has NOW, so the mark
// holds at once instead of lapsing because the status changed under it.

vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn().mockResolvedValue('admin@example.com') }));
vi.mock('@/lib/audit/run', () => ({
  runAuditReport: vi.fn().mockResolvedValue({ audited: 0, applied: new Set<string>() }),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const { POST } = await import('@/app/api/admin/checks/route');
const { fingerprintOf } = await import('@/lib/admin/adminChecks');

const send = (body: unknown) =>
  POST(new Request('http://x/api/admin/checks', { method: 'POST', body: JSON.stringify(body) }));

type Sql = { values: unknown[] };
const writes = () => prismaMock.$executeRaw.mock.calls.map((c) => c[0] as Sql);
// What the client sends for an open report: the fingerprint of "open".
const OPEN_PRINT = fingerprintOf('report', { status: 'open' });
const ACK_PRINT = fingerprintOf('report', { status: 'acknowledged' });

beforeEach(() => {
  resetPrismaMock();
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
    if (typeof ops === 'function') return ops(prismaMock);
    return Array.isArray(ops) ? Promise.all(ops) : ops;
  });
  prismaMock.cvErrorReport.updateMany.mockResolvedValue({ count: 1 });
});

describe('Mark checked on a CV report', () => {
  it('acknowledges an open report and stores the fingerprint of acknowledged', async () => {
    prismaMock.cvErrorReport.findMany.mockResolvedValue([{ id: 'r1', status: 'acknowledged' }]);
    const res = await send({ items: [{ kind: 'report', subject: 'r1', fingerprint: OPEN_PRINT }] });
    expect(res.status).toBe(200);
    expect(prismaMock.cvErrorReport.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] }, status: 'open' },
      data: { status: 'acknowledged' },
    });
    expect(writes()[0]!.values).toEqual(['report', 'r1', ACK_PRINT, null, 'admin@example.com']);
    expect(ACK_PRINT).not.toBe(OPEN_PRINT);
  });

  it('writes the acknowledgement and the mark in one transaction', async () => {
    prismaMock.cvErrorReport.findMany.mockResolvedValue([{ id: 'r1', status: 'acknowledged' }]);
    await send({ items: [{ kind: 'report', subject: 'r1', fingerprint: OPEN_PRINT }] });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof prismaMock.$transaction.mock.calls[0]![0]).toBe('function');
    // Up to 200 upserts: a longer limit than the default.
    expect(prismaMock.$transaction.mock.calls[0]![1]).toEqual({ timeout: 15_000 });
  });

  it('keeps the true status for a report already closed, and drops one that is gone', async () => {
    prismaMock.cvErrorReport.findMany.mockResolvedValue([{ id: 'r2', status: 'fixed' }]);
    const res = await send({
      items: [
        { kind: 'report', subject: 'r2', fingerprint: OPEN_PRINT },
        { kind: 'report', subject: 'gone', fingerprint: OPEN_PRINT },
      ],
    });
    expect(await res.json()).toEqual({ marked: 1, applied: 0 });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.values[2]).toBe(fingerprintOf('report', { status: 'fixed' }));
  });

  it('does not touch reports when the items are of another kind', async () => {
    await send({
      items: [{ kind: 'import', subject: 'a.calicotab.com/x', fingerprint: ACK_PRINT }],
    });
    expect(prismaMock.cvErrorReport.updateMany).not.toHaveBeenCalled();
  });
});
