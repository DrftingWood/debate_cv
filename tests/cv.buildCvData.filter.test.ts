import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { buildCvData } = await import('@/lib/cv/buildCvData');

beforeEach(() => {
  resetPrismaMock();
});

describe('buildCvData — discoveredUrl filter', () => {
  it('only pulls URLs that finished ingesting (audit #7)', async () => {
    // Sanity-stub everything else so buildCvData runs to the point we care
    // about. The assertion focuses on the discoveredUrl.findMany WHERE
    // clause — partially-ingested URLs (tournamentId set, ingestedAt null)
    // must NOT leak into the CV.
    prismaMock.user.findUnique.mockResolvedValue({
      name: 'Test',
      email: 't@e.com',
      image: null,
    });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    prismaMock.person.findMany.mockResolvedValue([]);
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
    prismaMock.teamResult.groupBy.mockResolvedValue([]);
    prismaMock.teamResult.findMany.mockResolvedValue([]);
    prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
    prismaMock.eliminationResult.findMany.mockResolvedValue([]);
    prismaMock.cvErrorReport.findMany.mockResolvedValue([]);

    await buildCvData('user-1');

    // The CV-data builder runs three queries in parallel; the discoveredUrl
    // one is the gate for "which tournaments do we even consider". It must
    // require both tournamentId AND ingestedAt to be set.
    const discoveredUrlCall = prismaMock.discoveredUrl.findMany.mock.calls[0]?.[0] as
      | { where: { userId: string; tournamentId: object; ingestedAt: object } }
      | undefined;
    expect(discoveredUrlCall?.where).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        tournamentId: { not: null },
        ingestedAt: { not: null },
      }),
    );
  });
});
