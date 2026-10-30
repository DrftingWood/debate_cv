import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// 2026-10-30: calicotab timeouts left new users with every name read failed
// and an empty name list; revisiting onboarding now reads those pages again.
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { resetRetryableNameReads } = await import('@/lib/identity/retryNameReads');

beforeEach(() => {
  resetPrismaMock();
  prismaMock.person.count.mockResolvedValue(0);
  prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
  prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 3 });
});

describe('resetRetryableNameReads', () => {
  it('puts failed reads that may pass back to unread, ten minutes on', async () => {
    await expect(resetRetryableNameReads('u1')).resolves.toBe(3);
    const args = prismaMock.discoveredUrl.updateMany.mock.calls[0]?.[0];
    expect(args.data).toEqual({ registrationName: null, lastPreflightError: null });
    expect(args.where).toMatchObject({
      userId: 'u1',
      registrationName: '',
      registrationPersonId: null,
    });
    expect(args.where.OR).toContainEqual({ lastPreflightError: { startsWith: 'HTTP 0' } });
    expect(args.where.OR).toContainEqual({ lastPreflightError: { startsWith: 'HTTP 5' } });
    expect(args.where.OR).not.toContainEqual({ lastPreflightError: { startsWith: 'HTTP 404' } });
    expect(Date.now() - args.where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(9 * 60_000);
  });

  it('leaves a user with a confirmed name alone', async () => {
    prismaMock.person.count.mockResolvedValue(1);
    await expect(resetRetryableNameReads('u1')).resolves.toBe(0);
    expect(prismaMock.discoveredUrl.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the reads alone once the sample has settled the name', async () => {
    prismaMock.discoveredUrl.findMany.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ registrationName: 'Abhishek Acharya' })),
    );
    await expect(resetRetryableNameReads('u1')).resolves.toBe(0);
    expect(prismaMock.discoveredUrl.updateMany).not.toHaveBeenCalled();
  });
});
