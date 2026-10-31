import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

// Task R11: the Captured tab's readers. The database is a mock that answers
// by the SQL it is asked; what is checked is what each reader asks for (the
// ignored filter, bound values rather than spliced text) and how it shapes
// the rows that come back.

const KEY = 'k3yS3cr3t';

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  db: {
    tournament: { groupBy: vi.fn(), count: vi.fn() },
    motion: { groupBy: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: { ...h.db, $queryRaw: h.queryRaw } }));

const captured = await import('@/lib/admin/captured');

const textOf = (q: Prisma.Sql) => q.sql;

beforeEach(() => {
  h.queryRaw.mockReset();
  h.db.tournament.groupBy.mockReset();
  h.db.tournament.count.mockReset();
  h.db.motion.groupBy.mockReset();
  h.db.motion.findMany.mockReset();
});

describe('readSize', () => {
  it('bins in SQL with the bounds bound as values, leaves ignored out, and clips nothing it should link', async () => {
    h.queryRaw
      .mockResolvedValueOnce([{ b0: 4, b1: 6, b2: 3, b3: 2, b4: 1, sampled: 16, median: 28 }])
      .mockResolvedValueOnce([
        {
          id: '9',
          name: 'Worlds',
          url: `https://w.calicotab.com/w/privateurls/${KEY}/`,
          teams: 400,
        },
      ]);
    h.db.tournament.count.mockResolvedValue(20);
    const s = await captured.readSize();
    expect(s.bins).toEqual([4, 6, 3, 2, 1]);
    expect(s.median).toBe(28);
    expect(s.sampled).toBe(16);
    expect(s.noTeams).toBe(4);
    expect(s.largest[0]!.teams).toBe(400);
    // The private key never reaches a link.
    expect(JSON.stringify(s)).not.toContain(KEY);
    expect(h.db.tournament.count).toHaveBeenCalledWith({ where: { ignored: false } });
    for (const [q] of h.queryRaw.mock.calls) {
      expect(textOf(q as Prisma.Sql)).toContain('"ignored" = false');
    }
    expect((h.queryRaw.mock.calls[0]![0] as Prisma.Sql).values).toEqual([
      16, 16, 32, 32, 64, 64, 128, 128,
    ]);
  });

  it('is all zeros for an empty database', async () => {
    h.queryRaw
      .mockResolvedValueOnce([{ b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, sampled: 0, median: null }])
      .mockResolvedValueOnce([]);
    h.db.tournament.count.mockResolvedValue(0);
    const s = await captured.readSize();
    expect(s).toMatchObject({ sampled: 0, noTeams: 0, median: null, largest: [] });
  });
});

describe('readGeography', () => {
  it('counts regions among tournaments that are not ignored, the null being the unknown', async () => {
    h.db.tournament.groupBy.mockResolvedValue([
      { region: null, _count: { _all: 5 } },
      { region: 'Europe', _count: { _all: 12 } },
      { region: 'Africa', _count: { _all: 2 } },
    ]);
    const g = await captured.readGeography();
    expect(h.db.tournament.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['region'], where: { ignored: false } }),
    );
    expect(g.rows).toEqual([
      { value: 'Europe', count: 12 },
      { value: null, count: 5 },
      { value: 'Africa', count: 2 },
    ]);
    expect(g.total).toBe(19);
  });
});

describe('readFormatsYears', () => {
  it('lists years newest first with no year last', async () => {
    h.db.tournament.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === 'year'
        ? [
            { year: 2023, _count: { _all: 9 } },
            { year: null, _count: { _all: 30 } },
            { year: 2025, _count: { _all: 4 } },
          ]
        : [
            { format: 'BP', _count: { _all: 40 } },
            { format: null, _count: { _all: 3 } },
          ],
    );
    const fy = await captured.readFormatsYears();
    expect(fy.years.map((y) => y.value)).toEqual(['2025', '2023', null]);
    expect(fy.formats).toEqual([
      { value: 'BP', count: 40 },
      { value: null, count: 3 },
    ]);
    expect(fy.total).toBe(43);
  });
});

describe('readMotionKinds', () => {
  it('counts motion types and the ten commonest topics, keeping the untagged apart', async () => {
    h.db.motion.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === 'motionType'
        ? [
            { motionType: 'THW', _count: { _all: 50 } },
            { motionType: null, _count: { _all: 7 } },
          ]
        : [
            { topic: null, _count: { _all: 90 } },
            ...Array.from({ length: 12 }, (_, i) => ({ topic: `T${i}`, _count: { _all: 12 - i } })),
          ],
    );
    const m = await captured.readMotionKinds();
    expect(h.db.motion.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tournament: { ignored: false } } }),
    );
    expect(m.total).toBe(57);
    expect(m.topics).toHaveLength(10);
    expect(m.topics[0]).toEqual({ value: 'T0', count: 12 });
    expect(m.topicsUntagged).toBe(90);
  });
});

const grp = (position: string | null, n: number, extra: { pts?: number; type?: string } = {}) => ({
  position,
  type: extra.type,
  n,
  pointsRows: n,
  pointsSum: extra.pts ?? 0,
  winRows: 0,
  winSum: 0,
});

describe('readBalance', () => {
  it('splits the seats, counts the team-rounds with no side, and binds the stored spellings', async () => {
    h.queryRaw.mockImplementation(async (q: Prisma.Sql) => {
      const sql = textOf(q);
      if (sql.includes('array_agg')) return [];
      if (sql.includes('COALESCE(one.mt')) {
        return [
          grp('OG', 40, { pts: 60, type: 'THW' }),
          grp('OO', 40, { pts: 60, type: 'THW' }),
          grp('CG', 40, { pts: 60, type: 'THW' }),
          grp('CO', 40, { pts: 60, type: 'THW' }),
          grp('OG', 4, { pts: 6, type: 'THR' }),
        ];
      }
      return [
        grp('OG', 100, { pts: 170 }),
        grp('OO', 100, { pts: 150 }),
        grp('CG', 100, { pts: 140 }),
        grp('CO', 100, { pts: 140 }),
        grp(null, 36),
      ];
    });
    const b = await captured.readBalance();
    expect(b.noSides).toBe(36);
    expect(b.overall.bp.rooms).toBe(100);
    expect(b.overall.bp.positions.map((p) => p.avg)).toEqual([1.7, 1.5, 1.4, 1.4]);
    expect(b.byType.shown.map((t) => t.type)).toEqual(['THW']);
    expect(b.byType.tooFew).toEqual([{ type: 'THR', rooms: 1 }]);
    // No two-team seat is stored, so that list is not even asked for.
    const asked = h.queryRaw.mock.calls.map(([q]) => q as Prisma.Sql);
    const bpQuery = asked.find((q) => textOf(q).includes('HAVING COUNT(*) = 4'))!;
    expect(bpQuery.values).toEqual(expect.arrayContaining(['OG', 'OO', 'CG', 'CO', 8, 20]));
    expect(textOf(bpQuery)).not.toContain("'OG'");
    expect(asked.some((q) => textOf(q).includes('HAVING COUNT(*) = 2'))).toBe(false);
    for (const q of asked) expect(textOf(q)).toContain('"ignored" = false');
  });
});

describe('readBalance, unbalanced motions', () => {
  it('puts each unbalanced motion with its tournament, the public tab address and its seats', async () => {
    h.queryRaw.mockImplementation(async (q: Prisma.Sql) => {
      const sql = textOf(q);
      if (sql.includes('HAVING COUNT(*) = 4')) {
        return [
          {
            motion: '77',
            pos: ['CG', 'CO', 'OG', 'OO'],
            vals: [1.0, 1.2, 2.1, 1.7],
            rooms: 12,
            spread: 1.1,
          },
        ];
      }
      if (sql.includes('COALESCE(one.mt')) return [];
      return [
        grp('OG', 12, { pts: 25 }),
        grp('OO', 12, { pts: 20 }),
        grp('CG', 12, { pts: 12 }),
        grp('CO', 12, { pts: 14 }),
      ];
    });
    h.db.motion.findMany.mockResolvedValue([
      {
        id: 77n,
        text: 'This House would ban zoos',
        roundLabel: 'Round 3',
        tournament: {
          id: 5n,
          name: 'Oxford IV',
          sourceUrlRaw: `https://ox.calicotab.com/ox/privateurls/${KEY}/`,
        },
      },
    ]);
    const b = await captured.readBalance();
    const m = b.unbalancedBp[0]!;
    expect(m).toMatchObject({ motionId: '77', rooms: 12, spread: 1.1 });
    expect(m.tournament).toEqual({
      id: '5',
      name: 'Oxford IV',
      tabUrl: 'https://ox.calicotab.com/ox/',
    });
    expect(m.seats).toEqual([
      { pos: 'CG', value: 1.0 },
      { pos: 'CO', value: 1.2 },
      { pos: 'OG', value: 2.1 },
      { pos: 'OO', value: 1.7 },
    ]);
    expect(JSON.stringify(b)).not.toContain(KEY);
  });
});

describe('countUnreleased', () => {
  it('counts tournaments that keep a page back, not ignored', async () => {
    h.db.tournament.count.mockResolvedValue(6);
    expect(await captured.countUnreleased()).toBe(6);
    expect(h.db.tournament.count).toHaveBeenCalledWith({
      where: { ignored: false, scrapePieces: { some: { status: 'withheld' } } },
    });
  });
});
