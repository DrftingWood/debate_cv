import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterParams, parseFilters } from '@/lib/admin/tournamentFilters';

// R12: an ignored tournament (a test or demo one) leaves every admin
// aggregate: the overview and its database score, the summary line's grouped
// counts, the Inbox's check candidates and the Tournaments list. Each read is
// checked by the `where` it asks of the database; a user's own CV (lib/cv)
// never reads the flag.

const h = vi.hoisted(() => ({
  db: {
    tournamentAudit: { findMany: vi.fn(), groupBy: vi.fn() },
    tournament: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));
vi.mock('@/lib/admin/tabStatus', () => ({
  loadTabStates: vi.fn(async () => new Map()),
  tabState: () => ({ state: 'loaded' }),
}));
vi.mock('@/lib/admin/inbox', () => ({ countInbox: vi.fn(), listInbox: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  h.db.tournamentAudit.findMany.mockResolvedValue([]);
  h.db.tournamentAudit.groupBy.mockResolvedValue([]);
  h.db.tournament.count.mockResolvedValue(0);
  h.db.tournament.findMany.mockResolvedValue([]);
});

describe('the overview and the summary', () => {
  it('read only the audits of tournaments that are not ignored, and count the ignored apart', async () => {
    const { getAccuracyOverview } = await import('@/lib/admin/accuracy');
    h.db.tournament.count.mockImplementation(async ({ where }: { where: { ignored: boolean } }) =>
      where.ignored ? 4 : 10,
    );
    const o = await getAccuracyOverview();
    expect(h.db.tournamentAudit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tournament: { ignored: false } } }),
    );
    expect(o.tournaments).toBe(10);
    expect(o.ignored).toBe(4);
  });

  it('groups the summary line over audits of tournaments that are not ignored', async () => {
    const { getSummary } = await import('@/lib/admin/summary');
    h.db.tournament.count.mockResolvedValue(0);
    await getSummary(Promise.resolve({ items: [], counts: {}, total: 0 }) as never).catch(() => {});
    expect(h.db.tournamentAudit.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tournament: { ignored: false } } }),
    );
  });
});

describe('the Inbox', () => {
  it('raises no check for an ignored tournament', async () => {
    vi.doUnmock('@/lib/admin/inbox');
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({
      prisma: {
        ...h.db,
        cvErrorReport: { findMany: vi.fn(async () => []) },
        ingestJob: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
        reviewFlag: { findMany: vi.fn(async () => []) },
        adminCheck: { findMany: vi.fn(async () => []) },
      },
    }));
    const { listInbox } = await import('@/lib/admin/inbox');
    await listInbox({ page: 1, kinds: new Set(['check']) as never }).catch(() => {});
    expect(h.db.tournamentAudit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tournament: { ignored: false } }),
      }),
    );
  });
});

describe('the Tournaments list', () => {
  it('leaves ignored tournaments out by default and shows only them under ?ignored=1', async () => {
    const { listTournaments } = await import('@/lib/admin/tournamentList');
    await listTournaments({ page: 1 });
    expect(h.db.tournament.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ignored: false } }),
    );
    expect(h.db.tournamentAudit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tournament: { ignored: false } } }),
    );
    h.db.tournament.findMany.mockClear();
    await listTournaments({ page: 1, filters: { ignored: true } });
    expect(h.db.tournament.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ignored: true } }),
    );
  });

  it('reads and writes the ?ignored=1 chip in the address', () => {
    expect(parseFilters({ ignored: '1' })).toEqual({ ignored: true });
    expect(parseFilters({ ignored: '0' })).toEqual({});
    expect(filterParams({ ignored: true, band: 'good' })).toEqual({ band: 'good', ignored: '1' });
  });
});
