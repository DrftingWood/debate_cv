import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task 5b: "is this tournament in the database?" The URL lookup, the
// batched lookup the admin tables use per row, and the paged list read model
// behind /admin/tournaments. The database is mocked; what is checked is what
// each asks it and what comes back, above all that a private key never does.

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
const { listTournaments, TOURNAMENTS_PER_PAGE } = await import('@/lib/admin/tournamentList');
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

describe('listTournaments', () => {
  it('reads page 2 with skip 20 and take 20, newest scrape first', async () => {
    h.db.tournament.count.mockResolvedValue(45);
    await listTournaments({ page: 2 });
    const arg = h.db.tournament.findMany.mock.calls[0]![0];
    expect(TOURNAMENTS_PER_PAGE).toBe(20);
    expect(arg).toMatchObject({ skip: 20, take: 20 });
    expect(arg.orderBy[0]).toEqual({ scrapedAt: 'desc' });
  });

  it('clamps a page past the end to the last page', async () => {
    h.db.tournament.count.mockResolvedValue(45);
    const r = await listTournaments({ page: 99 });
    expect(r).toMatchObject({ total: 45, page: 3, pages: 3 });
    expect(h.db.tournament.findMany.mock.calls[0]![0]).toMatchObject({ skip: 40 });
  });

  it('searches names case-insensitively', async () => {
    await listTournaments({ page: 1, q: 'oxford' });
    const where = { name: { contains: 'oxford', mode: 'insensitive' } };
    expect(h.db.tournament.count.mock.calls[0]![0]).toEqual({ where });
    expect(h.db.tournament.findMany.mock.calls[0]![0].where).toEqual(where);
  });

  it("fills score, partly loaded and on-CVs from batched reads of the page's ids", async () => {
    h.db.tournament.count.mockResolvedValue(2);
    h.db.tournament.findMany.mockResolvedValue([oxford, { ...oxford, id: 8n, name: 'Other' }]);
    h.db.tournamentAudit.findMany.mockResolvedValue([{ tournamentId: 7n, score: 95 }]);
    h.db.scrapePiece.groupBy.mockResolvedValue([{ tournamentId: 8n }]);
    h.db.discoveredUrl.groupBy.mockResolvedValue([
      { tournamentId: 7n, userId: 'u1' },
      { tournamentId: 7n, userId: 'u2' },
    ]);

    const r = await listTournaments({ page: 1 });

    for (const call of [
      h.db.tournamentAudit.findMany,
      h.db.scrapePiece.groupBy,
      h.db.discoveredUrl.groupBy,
    ]) {
      expect(call).toHaveBeenCalledTimes(1);
      expect(call.mock.calls[0]![0].where.tournamentId).toEqual({ in: [7n, 8n] });
    }
    expect(r.rows[0]).toMatchObject({
      id: '7',
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      score: 95,
      band: 'good',
      partlyLoaded: false,
      onCvs: 2,
      parserCurrent: true,
    });
    expect(r.rows[1]).toMatchObject({ score: null, band: null, partlyLoaded: true, onCvs: 0 });
    expect(JSON.stringify(r.rows)).not.toContain(KEY);
  });
});
