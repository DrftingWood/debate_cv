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
    const row = {
      id: 1n,
      name: 'Renamed Open',
      fingerprint: 'abc',
      sourceUrlRaw: 'https://t.calicotab.com/open/',
    };
    prismaMock.tournament.findMany.mockResolvedValue([row]);
    await expect(findTournamentByHostSlug('t.calicotab.com', 'open')).resolves.toBe(row);
    expect(prismaMock.tournament.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { sourceUrlRaw: { startsWith: 'https://t.calicotab.com/open/', mode: 'insensitive' } },
          { sourceUrlRaw: { startsWith: 'http://t.calicotab.com/open/', mode: 'insensitive' } },
        ],
      },
      take: 2,
    });
  });

  it('finds a row first stored over http://, whose name differs', async () => {
    const row = {
      id: 7n,
      name: '15th IITB Debate',
      fingerprint: 'f1',
      sourceUrlRaw:
        'http://15thiitbombaydebate.calicotab.com/15thiitbombaydebate2023/privateurls/x/',
    };
    // Emulate the database's prefix match over the OR.
    prismaMock.tournament.findMany.mockImplementation((async (args: {
      where: { OR: Array<{ sourceUrlRaw: { startsWith: string } }> };
    }) =>
      args.where.OR.some((c) =>
        row.sourceUrlRaw.toLowerCase().startsWith(c.sourceUrlRaw.startsWith.toLowerCase()),
      )
        ? [row]
        : []) as never);
    await expect(
      findTournamentByHostSlug('15thiitbombaydebate.calicotab.com', '15thiitbombaydebate2023'),
    ).resolves.toBe(row);
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
    const where = prismaMock.tournament.findMany.mock.calls[0]![0] as {
      where: { OR: Array<{ sourceUrlRaw: { startsWith: string } }> };
    };
    for (const c of where.where.OR) expect(c.sourceUrlRaw.startsWith.endsWith('/open/')).toBe(true);
  });
});

describe('fingerprints converge for a name with no year', () => {
  it("a private ingest whose year came from the email still tries the pre-scrape's null-year fingerprint", () => {
    const parts = {
      host: 't.calicotab.com',
      tournamentSlug: 'open',
      tournamentName: 'Novice Open',
    };
    const prescraped = candidateFingerprints({ ...parts, explicitYear: null, inferredYear: null });
    const fromPrivate = candidateFingerprints({ ...parts, explicitYear: null, inferredYear: 2024 });
    expect(prescraped).toHaveLength(1);
    expect(fromPrivate).toContain(prescraped[0]);
  });
});
