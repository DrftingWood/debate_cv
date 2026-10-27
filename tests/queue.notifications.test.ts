import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
const { writeNotification } = vi.hoisted(() => ({
  writeNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/notifications/write', () => ({ writeNotification }));

const { markJobDone, markJobFailed, markJobAbandoned } = await import('@/lib/queue');

/** count() answers by the status filter: open (pending/running) vs done. */
function counts(open: number, done: number) {
  prismaMock.ingestJob.count.mockImplementation((async (args: { where: { status: unknown } }) =>
    typeof args.where.status === 'string' ? done : open) as never);
}

const kinds = () => writeNotification.mock.calls.map((c) => c[0].kind);

beforeEach(() => {
  resetPrismaMock();
  writeNotification.mockClear();
  prismaMock.ingestJob.update.mockResolvedValue({ userId: 'u1' });
});

describe('failed ingest notice (C106)', () => {
  it('posts a plain-language, deduped bell notice when a job fails for good', async () => {
    counts(0, 0);
    await markJobFailed('j1', 'HTTP 500 boom');
    const call = writeNotification.mock.calls.find((c) => c[0].kind === 'ingest_failed')![0];
    expect(call.userId).toBe('u1');
    expect(call.title).toMatch(/couldn.t load/i);
    expect(call.body).not.toMatch(/HTTP|boom/);
    expect(call.dedupeWithinMs).toBeGreaterThan(0);
  });

  it('posts it for abandoned jobs too', async () => {
    counts(0, 0);
    await markJobAbandoned('j1', 'fetch landing HTTP 404');
    expect(kinds()).toContain('ingest_failed');
  });
});

describe('"Your CV is ready" (C106)', () => {
  it('fires when the queue is empty and a tournament loaded', async () => {
    counts(0, 1);
    await markJobDone('j1');
    expect(kinds()).toContain('ingest_done');
  });

  it('does not fire while jobs are still open', async () => {
    counts(2, 1);
    await markJobDone('j1');
    expect(writeNotification).not.toHaveBeenCalled();
  });

  it('does not fire when the queue empties on a failure and nothing loaded', async () => {
    counts(0, 0);
    await markJobFailed('j1', 'x');
    expect(kinds()).not.toContain('ingest_done');
  });

  it('fires when the last job fails but earlier ones loaded', async () => {
    counts(0, 3);
    await markJobFailed('j1', 'x');
    expect(kinds()).toContain('ingest_done');
  });
});
