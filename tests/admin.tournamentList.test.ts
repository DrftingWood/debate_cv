import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task R5: the Tournaments tab's read model. The database is an in-memory
// fixture behind a prisma mock; what is checked is which tournaments come
// back, in what order, and that the filters agree with the overview's own
// counts (the chips are labelled with those).

const KEY = 'k3yS3cr3t';

type T = { id: bigint; name: string; scrapedAt: Date };
type A = { tournamentId: bigint; score: number; usersAffected: number; checks: unknown };

const h = vi.hoisted(() => ({
  tournaments: [] as T[],
  audits: [] as A[],
  db: {
    tournament: { findMany: vi.fn() },
    tournamentAudit: { findMany: vi.fn() },
    scrapePiece: { findMany: vi.fn(), groupBy: vi.fn() },
    discoveredUrl: { groupBy: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const { listTournaments, TOURNAMENTS_PER_PAGE } = await import('@/lib/admin/tournamentList');
const { parseFilters, matchesFilters } = await import('@/lib/admin/tournamentFilters');
const { parseChecks } = await import('@/lib/admin/accuracy');
const { PARSER_VERSION } = await import('@/lib/calicotab/version');

const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const check = (code: string, status: string, extra: object = {}) => ({
  code,
  status,
  detail: `${code} ${status}`,
  pieces: [],
  ...extra,
});
const marked = check('panels', 'pass', {
  checkedBy: 'owner@example.com',
  checkedAt: '2026-10-30T10:00:00.000Z',
  wasStatus: 'fail',
});

/** Five tournaments: scores 95, 82, 40, 40 (more users), and one never audited. */
function seed() {
  h.tournaments = [
    { id: 1n, name: 'Alpha Open', scrapedAt: day(1) },
    { id: 2n, name: 'Beta Cup', scrapedAt: day(2) },
    { id: 3n, name: 'Gamma Open', scrapedAt: day(3) },
    { id: 4n, name: 'Delta Open', scrapedAt: day(4) },
    { id: 5n, name: 'Epsilon', scrapedAt: day(5) },
  ];
  h.audits = [
    { tournamentId: 1n, score: 95, usersAffected: 0, checks: [check('champion', 'pass'), marked] },
    { tournamentId: 2n, score: 82, usersAffected: 0, checks: [check('panels', 'warn')] },
    {
      tournamentId: 3n,
      score: 40,
      usersAffected: 1,
      checks: [
        check('champion', 'fail', { assumptions: ['no_open_bracket_champion'] }),
        check('rounds_complete', 'fail'),
      ],
    },
    { tournamentId: 4n, score: 40, usersAffected: 5, checks: [check('champion', 'fail')] },
  ];
}

const idsOf = (r: { rows: Array<{ id: string }> }) => r.rows.map((x) => x.id);

beforeEach(() => {
  for (const model of Object.values(h.db)) for (const fn of Object.values(model)) fn.mockReset();
  seed();
  // The universe read selects ids; the page read selects the columns shown.
  h.db.tournament.findMany.mockImplementation(
    async (arg: { where?: { id?: { in: bigint[] }; name?: { contains: string } } }) => {
      const ids = arg.where?.id?.in;
      const needle = arg.where?.name?.contains.toLowerCase();
      return h.tournaments
        .filter((t) => (ids ? ids.includes(t.id) : true))
        .filter((t) => (needle ? t.name.toLowerCase().includes(needle) : true))
        .map((t) => ({
          ...t,
          sourceUrlRaw: `https://t${t.id}.calicotab.com/t${t.id}/privateurls/${KEY}/`,
          year: 2025,
          format: 'BP',
          parserVersion: PARSER_VERSION,
        }));
    },
  );
  h.db.tournamentAudit.findMany.mockImplementation(
    async (arg: { where?: { score?: { gte?: number; lt?: number } } }) =>
      h.audits.filter(
        (a) =>
          (arg.where?.score?.gte === undefined || a.score >= arg.where.score.gte) &&
          (arg.where?.score?.lt === undefined || a.score < arg.where.score.lt),
      ),
  );
  h.db.scrapePiece.findMany.mockResolvedValue([]);
  h.db.scrapePiece.groupBy.mockResolvedValue([]);
  h.db.discoveredUrl.groupBy.mockResolvedValue([]);
});

describe('listTournaments order and paging', () => {
  it('lists the lowest score first, more users first among equals, unaudited last', async () => {
    const r = await listTournaments({ page: 1 });
    expect(idsOf(r)).toEqual(['4', '3', '2', '1', '5']);
    expect(r).toMatchObject({ total: 5, page: 1, pages: 1 });
    expect(r.rows[4]).toMatchObject({ score: null, band: null });
  });

  it('pages twenty a page and clamps a page past the end', async () => {
    h.tournaments = Array.from({ length: 45 }, (_, i) => ({
      id: BigInt(i + 1),
      name: `T${i + 1}`,
      scrapedAt: day(1),
    }));
    h.audits = [];
    const last = await listTournaments({ page: 99 });
    expect(TOURNAMENTS_PER_PAGE).toBe(20);
    expect(last).toMatchObject({ total: 45, page: 3, pages: 3 });
    expect(last.rows).toHaveLength(5);
    const first = await listTournaments({ page: 1 });
    const second = await listTournaments({ page: 2 });
    expect(second.rows).toHaveLength(20);
    // Ties keep a fixed order, so no row shows on two pages or none.
    const seen = new Set(first.rows.map((x) => x.id));
    expect(second.rows.some((x) => seen.has(x.id))).toBe(false);
  });

  it('searches names case-insensitively, with the order kept', async () => {
    const r = await listTournaments({ page: 1, q: 'OPEN' });
    expect(idsOf(r)).toEqual(['4', '3', '1']);
  });

  it('never returns the private key', async () => {
    const r = await listTournaments({ page: 1 });
    expect(r.rows[0]!.tabUrl).toBe('https://t4.calicotab.com/t4/');
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe('listTournaments filters', () => {
  it('?check keeps tournaments failing that check', async () => {
    const r = await listTournaments({ page: 1, filters: { check: 'champion' } });
    expect(idsOf(r)).toEqual(['4', '3']);
  });

  it('?band keeps one band', async () => {
    const rescrape = await listTournaments({ page: 1, filters: { band: 'rescrape' } });
    expect(idsOf(rescrape)).toEqual(['4', '3']);
    const check = await listTournaments({ page: 1, filters: { band: 'check' } });
    expect(idsOf(check)).toEqual(['2']);
    const good = await listTournaments({ page: 1, filters: { band: 'good' } });
    expect(idsOf(good)).toEqual(['1']);
  });

  it('?question keeps tournaments the open rule decided', async () => {
    const r = await listTournaments({ page: 1, filters: { question: 'no_open_bracket_champion' } });
    expect(idsOf(r)).toEqual(['3']);
  });

  it('?checked keeps tournaments with a mark applied', async () => {
    const r = await listTournaments({ page: 1, filters: { checked: true } });
    expect(idsOf(r)).toEqual(['1']);
  });

  it('filters narrow together and with the name search', async () => {
    const both = await listTournaments({
      page: 1,
      q: 'gamma',
      filters: { check: 'champion', band: 'rescrape' },
    });
    expect(idsOf(both)).toEqual(['3']);
    const none = await listTournaments({ page: 1, q: 'beta', filters: { check: 'champion' } });
    expect(none).toMatchObject({ total: 0, rows: [], page: 1, pages: 1 });
  });

  it('a marked check is a pass and a warning is not a failure, so neither is listed', async () => {
    const r = await listTournaments({ page: 1, filters: { check: 'panels' } });
    expect(idsOf(r)).toEqual([]);
  });
});

describe('row facts', () => {
  it('gives the tab state with failed pages, the withheld count and users on CVs', async () => {
    h.db.scrapePiece.findMany.mockResolvedValue([
      { tournamentId: 3n, label: 'R2', httpStatus: 503, lastError: null },
    ]);
    h.db.scrapePiece.groupBy.mockResolvedValue([{ tournamentId: 3n, _count: { _all: 2 } }]);
    h.db.discoveredUrl.groupBy.mockResolvedValue([
      { tournamentId: 3n, userId: 'u1' },
      { tournamentId: 3n, userId: 'u2' },
    ]);
    const r = await listTournaments({ page: 1 });
    const gamma = r.rows.find((x) => x.id === '3')!;
    expect(gamma.tab).toMatchObject({
      state: 'partial',
      errors: ['R2: HTTP 503 Service Unavailable'],
    });
    expect(gamma).toMatchObject({ withheld: 2, onCvs: 2 });
    expect(r.rows.find((x) => x.id === '1')!.tab.state).toBe('loaded');
  });
});

describe('parseFilters and matchesFilters', () => {
  it('reads known words and ignores the rest', () => {
    expect(
      parseFilters({
        check: 'panels',
        band: 'good',
        question: 'no_open_bracket_champion',
        checked: '1',
      }),
    ).toEqual({
      check: 'panels',
      band: 'good',
      question: 'no_open_bracket_champion',
      checked: true,
    });
    expect(parseFilters({ check: 'bogus', band: 'great', question: 'x', checked: '0' })).toEqual(
      {},
    );
    expect(parseFilters({ check: ['champion', 'panels'] })).toEqual({ check: 'champion' });
  });

  it('matches by the overview rule: open user reports count as failing', () => {
    const checks = parseChecks([check('user_reports', 'warn')]);
    const audit = { score: 60, bandOf: 'rescrape' as const, checks };
    expect(matchesFilters(audit, { check: 'user_reports' })).toBe(true);
  });
});
