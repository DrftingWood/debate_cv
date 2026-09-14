import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { rescheduleJob, resetStuckRunning } = await import('@/lib/queue');

beforeEach(() => {
  resetPrismaMock();
});

describe('rescheduleJob', () => {
  it('bumps scheduledAt so retries do not starve fresh submissions', async () => {
    // Audit #9: previously rescheduleJob left scheduledAt at the original
    // submit time, so a backed-up failed job kept getting priority over
    // newly-enqueued URLs in claimOnePending's `ORDER BY scheduledAt ASC`.
    prismaMock.ingestJob.update.mockResolvedValue({ id: 'job1' });
    await rescheduleJob('job1', 'transient error');

    expect(prismaMock.ingestJob.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({
        status: 'pending',
        startedAt: null,
        scheduledAt: expect.any(Date),
        lastError: 'transient error',
      }),
    });
  });

  it('truncates the error message to 2000 chars', async () => {
    prismaMock.ingestJob.update.mockResolvedValue({ id: 'job1' });
    const long = 'x'.repeat(3000);
    await rescheduleJob('job1', long);
    const arg = prismaMock.ingestJob.update.mock.calls[0]![0] as {
      data: { lastError: string };
    };
    expect(arg.data.lastError).toHaveLength(2000);
  });
});

describe('resetStuckRunning', () => {
  // The counterpart to the rescheduleJob fix above. A job whose ingest
  // outlives the serverless function's budget is killed mid-flight, so no
  // catch block runs and it is recovered here rather than by rescheduleJob.
  // Leaving scheduledAt untouched put it straight back at the head of
  // `ORDER BY scheduledAt ASC`, where it was claimed first, killed again,
  // and starved every other user's jobs behind it — forever, because the
  // attempt ceiling is only enforced inside the catch.
  it('sends recovered jobs to the back of the queue', async () => {
    prismaMock.$executeRaw.mockResolvedValue(1);
    await resetStuckRunning({});

    const sql = prismaMock.$executeRaw.mock.calls[0]![0] as { strings?: string[] };
    const text = (sql.strings ?? []).join('?');
    expect(text).toMatch(/"scheduledAt"\s*=\s*NOW\(\)/);
    expect(text).toMatch(/"status"\s*=\s*'pending'/);
    expect(text).toMatch(/"startedAt"\s*=\s*NULL/);
  });

  it('scopes to one user when asked, and still re-queues', async () => {
    prismaMock.$executeRaw.mockResolvedValue(1);
    await resetStuckRunning({ userId: 'user-1' });

    const sql = prismaMock.$executeRaw.mock.calls[0]![0] as { strings?: string[] };
    const text = (sql.strings ?? []).join('?');
    expect(text).toMatch(/"userId"/);
    expect(text).toMatch(/"scheduledAt"\s*=\s*NOW\(\)/);
  });
});
