import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

// Task R1: POST /api/admin/checks marks items checked and DELETE undoes one.
// For tournament checks both re-audit the tournament before replying, so the
// score the admin sees next already counts (or no longer counts) the mark.

vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const runAuditMock = vi.fn();
vi.mock('@/lib/audit/run', () => ({ runAuditReport: runAuditMock }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const { POST, DELETE } = await import('@/app/api/admin/checks/route');

const URL_ = 'http://x/api/admin/checks';
const send = (method: 'POST' | 'DELETE', body: unknown) =>
  (method === 'POST' ? POST : DELETE)(new Request(URL_, { method, body: JSON.stringify(body) }));

const FP = '0123456789abcdef';
type Sql = { sql: string; values: unknown[] };
const statements = () => prismaMock.$executeRaw.mock.calls.map((c) => c[0] as Sql);

beforeEach(() => {
  resetPrismaMock();
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  runAuditMock.mockReset().mockResolvedValue({ audited: 1, applied: new Set<string>() });
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.$transaction.mockImplementation(async (ops: unknown) =>
    Array.isArray(ops) ? Promise.all(ops) : ops,
  );
});

describe('admin only', () => {
  it('answers 403 to a non-admin on both methods, and writes nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const post = await send('POST', {
      items: [{ kind: 'check', subject: '5:panels', fingerprint: FP }],
    });
    const del = await send('DELETE', { kind: 'check', subject: '5:panels' });
    for (const res of [post, del]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(runAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/checks', () => {
  it('marks the items by the signed-in admin and re-audits each tournament once', async () => {
    const res = await send('POST', {
      items: [
        { kind: 'check', subject: '5:panels', fingerprint: FP },
        { kind: 'check', subject: '5:partners', fingerprint: FP },
        { kind: 'check', subject: '9:champion', fingerprint: FP },
        { kind: 'import', subject: 'oxiv.calicotab.com/oxiv2025', fingerprint: FP },
      ],
      note: 'looked at the tab',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: 4, applied: 0 });
    const writes = statements();
    expect(writes).toHaveLength(4);
    expect(writes[0]!.values).toEqual([
      'check',
      '5:panels',
      FP,
      'looked at the tab',
      'admin@example.com',
    ]);
    expect(runAuditMock).toHaveBeenCalledTimes(1);
    expect(runAuditMock.mock.calls[0][0]).toEqual([5n, 9n]);
  });

  it('applied counts only the requested check marks the re-audit applied', async () => {
    // 5:panels took effect; 5:partners' data changed (not applied); 5:motions
    // was applied but marked earlier, not in this request.
    runAuditMock.mockResolvedValue({ audited: 1, applied: new Set(['5:panels', '5:motions']) });
    const res = await send('POST', {
      items: [
        { kind: 'check', subject: '5:panels', fingerprint: FP },
        { kind: 'check', subject: '5:partners', fingerprint: FP },
      ],
    });
    expect(await res.json()).toEqual({ marked: 2, applied: 1 });
  });

  it('does not re-audit when no item is a tournament check', async () => {
    const res = await send('POST', {
      items: [{ kind: 'report', subject: '12', fingerprint: FP }],
    });
    expect(await res.json()).toEqual({ marked: 1, applied: 0 });
    expect(runAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/checks bodies', () => {
  it('rejects 201 items, an empty list, bad kinds, subjects and fingerprints with 400', async () => {
    const item = { kind: 'check', subject: '5:panels', fingerprint: FP };
    const bodies = [
      { items: Array.from({ length: 201 }, () => item) },
      { items: [] },
      { items: [{ ...item, kind: 'email' }] },
      { items: [{ ...item, subject: 'panels' }] },
      { items: [{ ...item, subject: '5:not_a_check' }] },
      { items: [{ ...item, fingerprint: 'XYZ' }] },
      { items: [item], note: 'x'.repeat(501) },
      null,
    ];
    for (const body of bodies) {
      const res = await send('POST', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    }
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers a code, not the message, when the database fails', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('relation "AdminCheck" does not exist'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send('POST', {
      items: [{ kind: 'check', subject: '5:panels', fingerprint: FP }],
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });
});

describe('DELETE /api/admin/checks', () => {
  it('undoes a mark and re-audits its tournament', async () => {
    const res = await send('DELETE', { kind: 'check', subject: '5:panels' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(statements()[0]!.sql).toMatch(/^\s*DELETE FROM "AdminCheck"/);
    expect(statements()[0]!.values).toEqual(['check', '5:panels']);
    expect(runAuditMock).toHaveBeenCalledWith([5n]);
  });

  it('undoing another kind re-audits nothing; a bad body is 400', async () => {
    await send('DELETE', { kind: 'parser', subject: 'speakerTab|No speakers' });
    expect(runAuditMock).not.toHaveBeenCalled();
    expect((await send('DELETE', { kind: 'check' })).status).toBe(400);
  });
});
