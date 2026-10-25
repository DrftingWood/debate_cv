import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// B9 condition C1: before a Tournament is created, a stored row for the same
// site (host + slug) is adopted — but only when exactly one exists.
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { findTournamentByHostSlug } = await import('@/lib/calicotab/ingest');
const { candidateFingerprints } = await import('@/lib/calicotab/fingerprint');

beforeEach(() => resetPrismaMock());

describe('findTournamentByHostSlug', () => {
  it('adopts the one stored tournament for the site, whatever its name', async () => {
    const row = { id: 1n, name: 'Renamed Open', fingerprint: 'abc', sourceUrlRaw: 'https://t.calicotab.com/open/' };
    prismaMock.tournament.findMany.mockResolvedValue([row]);
    await expect(findTournamentByHostSlug('t.calicotab.com', 'open')).resolves.toBe(row);
    expect(prismaMock.tournament.findMany).toHaveBeenCalledWith({
      where: { sourceUrlRaw: { startsWith: 'https://t.calicotab.com/open/', mode: 'insensitive' } },
      take: 2,
    });
  });

  it('adopts none when two rows claim the site: never guess', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
    await expect(findTournamentByHostSlug('t.calicotab.com', 'open')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a site with no slug is never looked up', async () => {
    await expect(findTournamentByHostSlug('t.calicotab.com', null)).resolves.toBeNull();
    expect(prismaMock.tournament.findMany).not.toHaveBeenCalled();
  });

  it('the slug is a whole path segment: "open" never matches "open2"', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([]);
    await findTournamentByHostSlug('t.calicotab.com', 'open');
    const where = prismaMock.tournament.findMany.mock.calls[0]![0] as { where: { sourceUrlRaw: { startsWith: string } } };
    expect(where.where.sourceUrlRaw.startsWith.endsWith('/open/')).toBe(true);
  });
});

describe('fingerprints converge for a name with no year', () => {
  it("a private ingest whose year came from the email still tries the pre-scrape's null-year fingerprint", () => {
    const parts = { host: 't.calicotab.com', tournamentSlug: 'open', tournamentName: 'Novice Open' };
    const prescraped = candidateFingerprints({ ...parts, explicitYear: null, inferredYear: null });
    const fromPrivate = candidateFingerprints({ ...parts, explicitYear: null, inferredYear: 2024 });
    expect(prescraped).toHaveLength(1);
    expect(fromPrivate).toContain(prescraped[0]);
  });
});
