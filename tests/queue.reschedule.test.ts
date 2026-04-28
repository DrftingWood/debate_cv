import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { rescheduleJob } = await import('@/lib/queue');

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
