import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { writeNotification } = await import('@/lib/notifications/write');

beforeEach(() => {
  resetPrismaMock();
});

describe('writeNotification', () => {
  it('writes a notification with no dedupe when dedupeWithinMs is unset', async () => {
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
    await writeNotification({
      userId: 'u1',
      kind: 'test',
      title: 'hi',
    });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: { userId: 'u1', kind: 'test', title: 'hi', body: undefined, href: undefined },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('runs dedupe check + create inside a Serializable transaction when dedupeWithinMs is set', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' });

    await writeNotification({
      userId: 'u1',
      kind: 'ingest_done',
      title: 'CV ready',
      dedupeWithinMs: 60_000,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const opts = prismaMock.$transaction.mock.calls[0]![1] as
      | { isolationLevel?: string }
      | undefined;
    expect(opts?.isolationLevel).toBe('Serializable');
    expect(prismaMock.notification.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'u1',
        kind: 'ingest_done',
      }),
      select: { id: true },
    });
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it('skips create when a recent notification exists in the dedupe window', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'older' });
    await writeNotification({
      userId: 'u1',
      kind: 'ingest_done',
      title: 'CV ready',
      dedupeWithinMs: 60_000,
    });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('swallows Postgres serialization_failure (40001) — dedup race resolved', async () => {
    // Simulate the race: another transaction wrote the same (userId, kind)
    // between our findFirst and our create. Postgres aborts our tx with a
    // 40001 error. The helper must NOT throw — that's the desired outcome.
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('serialization_failure'), { code: '40001' }),
    );
    await expect(
      writeNotification({
        userId: 'u1',
        kind: 'ingest_done',
        title: 'CV ready',
        dedupeWithinMs: 60_000,
      }),
    ).resolves.toBeUndefined();
  });

  it('also swallows Prisma P2034 (write conflict) — same race class', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('write conflict'), { code: 'P2034' }),
    );
    await expect(
      writeNotification({
        userId: 'u1',
        kind: 'ingest_done',
        title: 'CV ready',
        dedupeWithinMs: 60_000,
      }),
    ).resolves.toBeUndefined();
  });

  it('outer try-catch swallows unrelated errors (helper is best-effort)', async () => {
    prismaMock.notification.create.mockRejectedValue(new Error('connection lost'));
    await expect(
      writeNotification({ userId: 'u1', kind: 'test', title: 'hi' }),
    ).resolves.toBeUndefined();
  });
});
