import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => m.authMockModule));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn() }));

import { GET } from '@/app/api/ingest/progress/route';
import { requireAdmin } from '@/lib/admin';
import {
  authMock,
  fakeSession,
  prismaMock,
  resetPrismaMock,
  expectUnauthorized,
} from '../setup/api-test-utils';

const requireAdminMock = vi.mocked(requireAdmin);

/**
 * Drives one buildScope worth of prisma calls. The route runs two scopes
 * for admins (user + global) — the count/findFirst/findMany mocks resolve
 * the same values for both, which is fine: the tests assert on shape and
 * arithmetic, and scoping is exercised via the where clauses below.
 */
function primeScope({
  pending = 0,
  running = 0,
  doneRecent = 0,
  failedRecent = 0,
  currentJob = null as { url: string; startedAt: Date } | null,
  durationsMs = [] as number[],
} = {}) {
  prismaMock.ingestJob.count
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(running)
    .mockResolvedValueOnce(doneRecent)
    .mockResolvedValueOnce(failedRecent)
    // Second scope (admin/global) repeats the same sequence.
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(running)
    .mockResolvedValueOnce(doneRecent)
    .mockResolvedValueOnce(failedRecent);
  prismaMock.ingestJob.findFirst.mockResolvedValue(currentJob);
  const now = Date.now();
  prismaMock.ingestJob.findMany.mockResolvedValue(
    durationsMs.map((ms, i) => ({
      startedAt: new Date(now - ms - i * 60_000),
      finishedAt: new Date(now - i * 60_000),
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPrismaMock();
  authMock.mockResolvedValue(fakeSession('user-1'));
  requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
});

describe('GET /api/ingest/progress', () => {
  it('returns 401 when unauthenticated', async () => {
    await expectUnauthorized(() => GET());
  });

  it('returns the user scope with batch arithmetic and a null global for non-admins', async () => {
    primeScope({ pending: 8, running: 1, doneRecent: 3, failedRecent: 1 });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { batchTotal: number; pending: number; etaSeconds: number | null };
      global: unknown;
    };
    expect(body.user.pending).toBe(8);
    expect(body.user.batchTotal).toBe(13); // 8 + 1 + 3 + 1
    expect(body.global).toBeNull();
  });

  it('computes the ETA from recent job durations', async () => {
    // 4 queued + 0 running, recent jobs averaged 10s each → ~40s ETA.
    primeScope({ pending: 4, durationsMs: [10_000, 10_000, 10_000] });
    const res = await GET();
    const body = (await res.json()) as {
      user: { avgJobSeconds: number | null; etaSeconds: number | null };
    };
    expect(body.user.avgJobSeconds).toBeCloseTo(10, 0);
    expect(body.user.etaSeconds).toBe(40);
  });

  it('falls back to the conservative default when there is no duration history', async () => {
    primeScope({ pending: 2 });
    const res = await GET();
    const body = (await res.json()) as { user: { avgJobSeconds: null; etaSeconds: number } };
    expect(body.user.avgJobSeconds).toBeNull();
    expect(body.user.etaSeconds).toBe(80); // 2 × 40s default
  });

  it('reports a null ETA when nothing is queued or running', async () => {
    primeScope({ doneRecent: 5 });
    const res = await GET();
    const body = (await res.json()) as { user: { etaSeconds: number | null; batchTotal: number } };
    expect(body.user.etaSeconds).toBeNull();
    expect(body.user.batchTotal).toBe(5);
  });

  it('includes the global scope for admins, scoped without a userId filter', async () => {
    requireAdminMock.mockResolvedValue('admin@example.com');
    primeScope({ pending: 1, running: 1, currentJob: { url: 'https://x.calicotab.com/t/privateurls/abc/', startedAt: new Date() } });
    const res = await GET();
    const body = (await res.json()) as {
      user: { currentUrl: string | null };
      global: { currentUrl: string | null; batchTotal: number } | null;
    };
    expect(body.global).not.toBeNull();
    expect(body.global!.currentUrl).toContain('calicotab.com');
    // First four counts are user-scoped (where includes userId), the next
    // four are global (where has no userId).
    const wheres = prismaMock.ingestJob.count.mock.calls.map(
      (c) => (c[0] as { where: Record<string, unknown> }).where,
    );
    expect(wheres[0]).toHaveProperty('userId', 'user-1');
    expect(wheres[4]).not.toHaveProperty('userId');
  });
});
