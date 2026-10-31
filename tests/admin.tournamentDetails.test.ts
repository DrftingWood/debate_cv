import { beforeEach, describe, expect, it, vi } from 'vitest';

// Format, year and region by hand (owner, 2026-10-31). The database is
// mocked; a scrape must never overwrite a field set here.

const h = vi.hoisted(() => ({
  db: { tournament: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const { setTournamentDetails, scrapeDetailWrites } = await import('@/lib/admin/tournamentDetails');
const { changedDetails } = await import('@/components/admin/TournamentDetailsForm');

beforeEach(() => {
  vi.clearAllMocks();
  h.db.tournament.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      format: null,
      year: null,
      region: null,
      ...data,
    }),
  );
});

describe('setTournamentDetails', () => {
  it('writes only the fields sent and lists them as set by hand', async () => {
    h.db.tournament.findUnique.mockResolvedValue({ manualFields: ['region'] });
    const saved = await setTournamentDetails(4n, { format: 'World Schools', year: 2021 });
    expect(h.db.tournament.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 4n },
        data: { format: 'World Schools', year: 2021, manualFields: ['region', 'format', 'year'] },
      }),
    );
    expect(saved?.manual).toEqual(['region', 'format', 'year']);
  });
  it('clearing a field hands it back to the automatic fill', async () => {
    h.db.tournament.findUnique.mockResolvedValue({ manualFields: ['format', 'year'] });
    await setTournamentDetails(4n, { format: null });
    expect(h.db.tournament.update.mock.calls[0]![0].data).toEqual({
      format: null,
      manualFields: ['year'],
    });
  });
  it('answers null for a missing tournament', async () => {
    h.db.tournament.findUnique.mockResolvedValue(null);
    expect(await setTournamentDetails(4n, { year: 2020 })).toBeNull();
    expect(h.db.tournament.update).not.toHaveBeenCalled();
  });
});

describe('scrapeDetailWrites', () => {
  const inferred = { format: 'British Parliamentary', year: 2024 };
  it('writes what the scrape found when nothing was set by hand', () => {
    expect(scrapeDetailWrites([], inferred, false)).toEqual(inferred);
  });
  it('never writes a field set by hand', () => {
    expect(scrapeDetailWrites(['format', 'year'], inferred, false)).toEqual({
      format: undefined,
      year: undefined,
    });
  });
  it('never erases with a null, and writes no format from a partial re-scrape', () => {
    expect(scrapeDetailWrites([], { format: null, year: null }, false)).toEqual({
      format: undefined,
      year: undefined,
    });
    expect(scrapeDetailWrites([], inferred, true)).toEqual({ format: undefined, year: 2024 });
  });
});

describe('changedDetails (the form)', () => {
  const stored = { format: 'Asian Parliamentary', year: 2021, region: null, manual: [] };
  const range = { min: 1990, max: 2100 };
  it('sends only what changed; "Not set" sends null', () => {
    expect(
      changedDetails(stored, { format: '', year: '2021', region: 'South Asia' }, range),
    ).toEqual({ format: null, region: 'South Asia' });
    expect(
      changedDetails(stored, { format: 'Asian Parliamentary', year: '2021', region: '' }, range),
    ).toEqual({});
  });
  it('checks the year before sending', () => {
    const at = (year: string) =>
      changedDetails(stored, { format: 'Asian Parliamentary', year, region: '' }, range);
    expect(at('21')).toBe('Type a four-digit year, or leave it empty.');
    expect(at('1850')).toBe('Type a year from 1990 to 2100.');
    expect(at('2022')).toEqual({ year: 2022 });
    expect(at('')).toEqual({ year: null });
  });
});
