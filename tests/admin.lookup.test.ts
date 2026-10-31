import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task 5b: "is this tournament in the database?" The URL lookup and the
// batched lookup the admin tables use per row (the paged list read model has
// its own suite, admin.tournamentList.test.ts). The database is mocked; what
// is checked is what each asks it and what comes back, above all that a
// private key never does.

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;

const h = vi.hoisted(() => ({
  db: {
    tournament: { count: vi.fn(), findMany: vi.fn() },
    tournamentAudit: { findUnique: vi.fn(), findMany: vi.fn() },
    scrapePiece: { count: vi.fn(), groupBy: vi.fn() },
    discoveredUrl: { groupBy: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const { lookupTournament, storedTournamentIdsByUrl } = await import('@/lib/admin/tournamentLookup');
const { PARSER_VERSION } = await import('@/lib/calicotab/version');

const SCRAPED = new Date('2026-10-30T09:00:00Z');
const oxford = {
  id: 7n,
  name: 'Oxford IV 2025',
  sourceUrlRaw: PRIVATE,
  scrapedAt: SCRAPED,
  parserVersion: PARSER_VERSION,
  year: 2025,
  format: 'BP',
};

beforeEach(() => {
  for (const model of Object.values(h.db)) for (const fn of Object.values(model)) fn.mockReset();
  h.db.tournament.findMany.mockResolvedValue([]);
  h.db.tournament.count.mockResolvedValue(0);
  h.db.tournamentAudit.findUnique.mockResolvedValue(null);
  h.db.tournamentAudit.findMany.mockResolvedValue([]);
  h.db.scrapePiece.count.mockResolvedValue(0);
  h.db.scrapePiece.groupBy.mockResolvedValue([]);
  h.db.discoveredUrl.groupBy.mockResolvedValue([]);
});

describe('lookupTournament', () => {
  it('resolves a private URL to its stored tournament and never returns the key', async () => {
    h.db.tournament.findMany.mockResolvedValue([oxford]);
    h.db.tournamentAudit.findUnique.mockResolvedValue({ score: 74 });
    h.db.scrapePiece.count.mockResolvedValue(2);

    const r = await lookupTournament(PRIVATE);

    expect(r).toEqual({
      kind: 'stored',
      id: '7',
      name: 'Oxford IV 2025',
      publicUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      scrapedAt: SCRAPED,
      parserCurrent: true,
      score: 74,
      band: 'check',
      partlyLoaded: true,
    });
    const json = JSON.stringify(r);
    expect(json.toLowerCase()).not.toContain('privateurls');
    expect(json).not.toContain(KEY);
    // Looked up by host and slug, the key never part of the query.
    const where = JSON.stringify(h.db.tournament.findMany.mock.calls[0]![0].where);
    expect(where).toContain('oxiv.calicotab.com/oxiv2025/');
    expect(where).not.toContain(KEY);
  });

  it('says not stored, with the public tab, when no row has that slug', async () => {
    const r = await lookupTournament('https://wudc.calicotab.com/wudc2099/tab/team/');
    expect(r).toEqual({
      kind: 'not_stored',
      host: 'wudc.calicotab.com',
      slug: 'wudc2099',
      publicUrl: 'https://wudc.calicotab.com/wudc2099/',
    });
  });

  it('marks an old parser and an unaudited tournament', async () => {
    h.db.tournament.findMany.mockResolvedValue([{ ...oxford, parserVersion: 'old' }]);
    const r = await lookupTournament('https://oxiv.calicotab.com/oxiv2025/');
    expect(r).toMatchObject({ kind: 'stored', parserCurrent: false, score: null, band: null });
    expect(r).toMatchObject({ partlyLoaded: false });
  });

  it('calls garbage and other sites invalid, without asking the database', async () => {
    for (const input of ['not a url', 'ftp://oxiv.calicotab.com/x/', 'https://example.com/x/']) {
      expect(await lookupTournament(input)).toEqual({ kind: 'invalid' });
    }
    expect(h.db.tournament.findMany).not.toHaveBeenCalled();
  });
});

describe('storedTournamentIdsByUrl', () => {
  it('answers 30 URLs across 3 tournaments with one findMany', async () => {
    const slugs = ['alpha', 'beta', 'gamma'];
    h.db.tournament.findMany.mockResolvedValue(
      slugs.map((s, i) => ({
        id: BigInt(i + 1),
        name: s,
        sourceUrlRaw: `https://${s}.calicotab.com/${s}/`,
        scrapedAt: SCRAPED,
      })),
    );
    const urls = Array.from(
      { length: 30 },
      (_, i) => `https://${slugs[i % 3]}.calicotab.com/${slugs[i % 3]}/privateurls/key${i}/`,
    );

    const map = await storedTournamentIdsByUrl(urls);

    expect(h.db.tournament.findMany).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(30);
    expect(map.get(urls[4]!)).toEqual({ id: '2', name: 'beta', scrapedAt: SCRAPED });
    // One prefix pair per tournament, not per URL, and no key in the query.
    const where = h.db.tournament.findMany.mock.calls[0]![0].where;
    expect(where.OR).toHaveLength(6);
    expect(JSON.stringify(where)).not.toContain('privateurls');
  });

  it('leaves out unknown slugs, ambiguous ones and unreadable URLs', async () => {
    h.db.tournament.findMany.mockResolvedValue([
      { id: 1n, name: 'A', sourceUrlRaw: 'https://a.calicotab.com/one/', scrapedAt: SCRAPED },
      { id: 2n, name: 'B', sourceUrlRaw: 'https://a.calicotab.com/two/', scrapedAt: SCRAPED },
      { id: 3n, name: 'B2', sourceUrlRaw: 'http://a.calicotab.com/TWO/x/', scrapedAt: SCRAPED },
    ]);
    const map = await storedTournamentIdsByUrl([
      'https://a.calicotab.com/one/privateurls/k/',
      'https://a.calicotab.com/two/',
      'https://a.calicotab.com/three/',
      'garbage',
    ]);
    expect([...map.keys()]).toEqual(['https://a.calicotab.com/one/privateurls/k/']);
  });

  // Review of a00d4c0: a row is keyed the way the prefix query matched it,
  // not by parseTabAddress, so the table and a manual lookup agree.
  it('agrees with lookupTournament on a row the prefix matched', async () => {
    // Stored as http with mixed case, as some private URLs were.
    const row = { ...oxford, sourceUrlRaw: 'HTTP://OXIV.calicotab.com/OxIV2025/privateurls/k/' };
    h.db.tournament.findMany.mockResolvedValue([row]);
    const url = 'https://oxiv.calicotab.com/oxiv2025/';
    const map = await storedTournamentIdsByUrl([url]);
    const one = await lookupTournament(url);
    expect(map.get(url)).toMatchObject({ id: '7' });
    expect(one).toMatchObject({ kind: 'stored', id: '7' });
  });

  it('asks nothing when no URL can be read', async () => {
    expect((await storedTournamentIdsByUrl(['garbage'])).size).toBe(0);
    expect(h.db.tournament.findMany).not.toHaveBeenCalled();
  });
});
