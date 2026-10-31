import { beforeEach, describe, expect, it, vi } from 'vitest';
import { yearFillSummary } from '@/lib/admin/yearFillText';

// "Fill years from names": the database is a mock, the name reading is real.
const db = vi.hoisted(() => ({
  tournament: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

const { fillYearsBatch, missingYearWhere } = await import('@/lib/admin/yearFill');
const NOW = new Date('2026-10-31T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  db.tournament.updateMany.mockResolvedValue({ count: 1 });
  db.tournament.count.mockResolvedValue(0);
});

describe('fillYearsBatch', () => {
  it('writes the year only where there is none, and counts names without one', async () => {
    db.tournament.findMany.mockResolvedValue([
      { id: 1n, name: 'Preworlds24' },
      { id: 2n, name: 'Round 16' },
      { id: 3n, name: 'ERR 26' },
    ]);
    db.tournament.count.mockResolvedValue(5);
    const out = await fillYearsBatch(null, NOW);
    expect(out).toEqual({ filled: 2, noYear: 1, left: 5, next: '3' });
    expect(db.tournament.updateMany).toHaveBeenCalledTimes(2);
    expect(db.tournament.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, year: null },
      data: { year: 2024 },
    });
    expect(db.tournament.count).toHaveBeenCalledWith({ where: missingYearWhere(3n) });
  });

  it('does not count a row a scrape filled meanwhile', async () => {
    db.tournament.findMany.mockResolvedValue([{ id: 1n, name: 'WUDC 2023' }]);
    db.tournament.updateMany.mockResolvedValue({ count: 0 });
    expect((await fillYearsBatch(null, NOW)).filled).toBe(0);
  });

  it('ends with no cursor when nothing is left, and answers an empty pool', async () => {
    db.tournament.findMany.mockResolvedValue([]);
    expect(await fillYearsBatch(7n, NOW)).toEqual({ filled: 0, noYear: 0, left: 0, next: null });
    db.tournament.findMany.mockResolvedValue([{ id: 8n, name: 'x' }]);
    expect((await fillYearsBatch(7n, NOW)).next).toBeNull();
  });

  it('skips ignored tournaments and continues after the cursor', () => {
    expect(missingYearWhere(9n)).toEqual({ year: null, ignored: false, id: { gt: 9n } });
  });

  it('words the summary line', () => {
    expect(yearFillSummary({ filled: 12, noYear: 3, left: 40, next: '9' })).toBe(
      'Filled 12 · no year in name 3 · 40 left',
    );
  });
});
