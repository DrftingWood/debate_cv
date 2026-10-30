import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// Owner, 2026-10-30: pre-scraped tournaments have no date; the private URLs
// users' Gmail scans link to them give them their year.
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { fillTournamentYearFromEmails } = await import('@/lib/calicotab/yearFromEmail');

beforeEach(() => {
  resetPrismaMock();
  prismaMock.tournament.updateMany.mockResolvedValue({ count: 1 });
});

const earliest = (d: Date | null) =>
  prismaMock.discoveredUrl.aggregate.mockResolvedValue({ _min: { messageDate: d } } as never);

describe('fillTournamentYearFromEmails', () => {
  it('writes the UTC year of the earliest email, only where the year is missing', async () => {
    earliest(new Date('2024-12-31T23:30:00Z'));
    await expect(fillTournamentYearFromEmails(7n)).resolves.toBe(2024);
    expect(prismaMock.discoveredUrl.aggregate).toHaveBeenCalledWith({
      where: { tournamentId: 7n, messageDate: { not: null } },
      _min: { messageDate: true },
    });
    expect(prismaMock.tournament.updateMany).toHaveBeenCalledWith({
      where: { id: 7n, year: null },
      data: { year: 2024 },
    });
  });

  it('leaves a tournament that already has a year', async () => {
    earliest(new Date('2025-03-01T00:00:00Z'));
    prismaMock.tournament.updateMany.mockResolvedValue({ count: 0 });
    await expect(fillTournamentYearFromEmails(7n)).resolves.toBeNull();
  });

  it('writes nothing when no link to it has an email date', async () => {
    earliest(null);
    await expect(fillTournamentYearFromEmails(7n)).resolves.toBeNull();
    expect(prismaMock.tournament.updateMany).not.toHaveBeenCalled();
  });
});
