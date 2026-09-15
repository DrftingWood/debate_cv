import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
vi.mock('@/lib/calicotab/ingest', () => ({
  ingestPrivateUrl: vi.fn(),
  isDeadlockError: vi.fn(() => false),
}));
vi.mock('@/lib/queue', () => ({
  claimOnePending: vi.fn(),
  isPermanentError: vi.fn(() => false),
  markJobAbandoned: vi.fn(),
  markJobDone: vi.fn(),
  markJobFailed: vi.fn(),
  rescheduleJob: vi.fn(),
  resetStuckRunning: vi.fn(),
}));

const { POST } = await import('@/app/api/ingest/drain/route');
const { claimOnePending } = await import('@/lib/queue');

/** Stand-in for the IngestJob table, counted through the where clause. */
function seedJobs(jobs: Array<{ status: string }>) {
  type CountArgs = { where?: { status?: string | { in?: string[] } } };
  prismaMock.ingestJob.count.mockImplementation(async (args: CountArgs) => {
    const status = args?.where?.status;
    const wanted =
      typeof status === 'string' ? [status] : (status?.in ?? []);
    return jobs.filter((j) => wanted.includes(j.status)).length;
  });
}

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
  vi.mocked(claimOnePending).mockReset();
});

describe('POST /api/ingest/drain', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => POST()));

  it('counts jobs stuck in running as still remaining', async () => {
    // A 504 mid-ingest leaves the job in 'running'. resetStuckRunning
    // only reclaims rows older than 5 minutes, so counting 'pending'
    // alone reported remaining: 0 and let the client announce a
    // completed batch while a tournament was silently missing.
    authMock.mockResolvedValue(fakeSession('user-1'));
    vi.mocked(claimOnePending).mockResolvedValue(null);
    seedJobs([{ status: 'pending' }, { status: 'running' }, { status: 'done' }]);

    const res = await POST();
    const body = await readJson<{ processed: number; remaining: number }>(res);
    expect(body.processed).toBe(0);
    expect(body.remaining).toBe(2);
  });

  it('reports an empty queue when nothing is pending or running', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    vi.mocked(claimOnePending).mockResolvedValue(null);
    seedJobs([{ status: 'done' }, { status: 'abandoned' }]);

    const body = await readJson<{ remaining: number }>(await POST());
    expect(body.remaining).toBe(0);
  });
});
