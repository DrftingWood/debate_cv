import { describe, expect, it } from 'vitest';
import {
  BALANCE_MIN_ROOMS_TYPE,
  SIZE_BINS,
  balanceByType,
  binCounts,
  foldBalance,
  groupSides,
  medianOf,
  sizeBinIndex,
  sortedByUnbalance,
  type RawBalanceRow,
} from '@/lib/admin/capturedMath';

// Task R11: the arithmetic behind the Captured tab, with real numbers. The
// SQL only groups; everything the owner reads as a figure is decided here.

const row = (position: string, o: Partial<RawBalanceRow> = {}): RawBalanceRow => ({
  position,
  rows: 10,
  pointsRows: 10,
  pointsSum: 15,
  winRows: 0,
  winSum: 0,
  ...o,
});

describe('size bins', () => {
  it('puts the boundaries in the lower bin: 16, 32, 64, 128 stay, 17 / 33 / 65 / 129 move up', () => {
    const at = (n: number) => SIZE_BINS[sizeBinIndex(n)]!.label;
    expect([1, 16].map(at)).toEqual(['≤16', '≤16']);
    expect([17, 32].map(at)).toEqual(['17–32', '17–32']);
    expect([33, 64].map(at)).toEqual(['33–64', '33–64']);
    expect([65, 128].map(at)).toEqual(['65–128', '65–128']);
    expect([129, 400].map(at)).toEqual(['129+', '129+']);
  });

  it('counts a list of sizes into the five bins', () => {
    expect(binCounts([8, 16, 17, 40, 64, 65, 200, 300])).toEqual([2, 1, 2, 1, 2]);
  });

  it('takes the median of an odd and an even list, and null of none', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([10, 40, 20, 30])).toBe(25);
    expect(medianOf([])).toBeNull();
  });
});

describe('groupSides', () => {
  it('maps the stored spellings to the canonical positions', () => {
    const sides = groupSides([
      'OG',
      'Opening Government',
      'oo',
      'CG',
      'co',
      'Prop',
      'Gov',
      'Opp',
      'Neg',
      'Weird',
    ]);
    expect(sides.OG).toEqual(['OG', 'Opening Government']);
    expect(sides.OO).toEqual(['oo']);
    expect(sides.Prop).toEqual(['Prop', 'Gov']);
    expect(sides.Opp).toEqual(['Opp', 'Neg']);
    expect(sides.unknown).toEqual(['Weird']);
  });
});

describe('foldBalance', () => {
  it('averages points per BP position and counts the rooms', () => {
    const b = foldBalance([
      row('OG', { pointsRows: 40, pointsSum: 70 }),
      row('Opening Government', { pointsRows: 10, pointsSum: 10 }), // same seat, other spelling
      row('OO', { pointsRows: 50, pointsSum: 75 }),
      row('CG', { pointsRows: 50, pointsSum: 70 }),
      row('CO', { pointsRows: 50, pointsSum: 85 }),
    ]);
    expect(b.bp.positions.map((p) => [p.pos, p.n, p.avg])).toEqual([
      ['OG', 50, 1.6],
      ['OO', 50, 1.5],
      ['CG', 50, 1.4],
      ['CO', 50, 1.7],
    ]);
    expect(b.bp.rooms).toBe(50);
    expect(b.bp.spread).toBeCloseTo(0.3, 10);
    expect(b.two.rooms).toBe(0);
  });

  it('gives win share by side for two-team formats, rooms being half the team-rounds', () => {
    const b = foldBalance([
      row('Prop', { rows: 60, pointsRows: 0, pointsSum: 0, winRows: 60, winSum: 33 }),
      row('Gov', { rows: 20, pointsRows: 0, pointsSum: 0, winRows: 20, winSum: 11 }),
      row('Opp', { rows: 80, pointsRows: 0, pointsSum: 0, winRows: 80, winSum: 36 }),
    ]);
    const prop = b.two.positions.find((p) => p.pos === 'Prop')!;
    expect(prop.n).toBe(80);
    expect(prop.share).toBeCloseTo(44 / 80, 10);
    expect(b.two.positions.find((p) => p.pos === 'Opp')!.share).toBeCloseTo(0.45, 10);
    expect(b.two.rooms).toBe(80);
    expect(b.two.spread).toBeCloseTo(0.1, 10);
  });

  it('keeps unrecognised seats out of both splits and counts them', () => {
    const b = foldBalance([row('OG'), row('Table 3', { rows: 7 })]);
    expect(b.unrecognised).toBe(7);
    expect(b.bp.positions.find((p) => p.pos === 'OG')!.n).toBe(10);
  });

  it('answers null for a seat with no points rather than 0', () => {
    const b = foldBalance([row('OG', { pointsRows: 0, pointsSum: 0 })]);
    expect(b.bp.positions.find((p) => p.pos === 'OG')!.avg).toBeNull();
    expect(b.bp.spread).toBeNull();
  });
});

describe('balanceByType', () => {
  it('splits types at the rooms threshold, listing the small ones as too few', () => {
    const big = (type: string, n: number) =>
      ['OG', 'OO', 'CG', 'CO'].map((p) => ({ type, ...row(p, { pointsRows: n, pointsSum: n }) }));
    const out = balanceByType([...big('THW', BALANCE_MIN_ROOMS_TYPE), ...big('THR', 5)]);
    expect(out.shown.map((t) => [t.type, t.balance.bp.rooms])).toEqual([
      ['THW', BALANCE_MIN_ROOMS_TYPE],
    ]);
    expect(out.tooFew).toEqual([{ type: 'THR', bp: 5, two: 0 }]);
  });
});

describe('balanceByType, each kind of room on its own', () => {
  it('does not add four-team and two-team rooms to reach the threshold', () => {
    const bp = ['OG', 'OO', 'CG', 'CO'].map((p) => ({
      type: 'THP',
      ...row(p, { pointsRows: 25 }),
    }));
    const two = ['Prop', 'Opp'].map((p) => ({
      type: 'THP',
      ...row(p, { pointsRows: 0, winRows: 25, winSum: 12 }),
    }));
    // 25 + 25 rooms is two small samples, not one of 50.
    expect(balanceByType([...bp, ...two]).tooFew).toEqual([{ type: 'THP', bp: 25, two: 25 }]);
  });
});

describe('sortedByUnbalance', () => {
  it('orders by spread, then by more rooms', () => {
    const out = sortedByUnbalance([
      { id: 'a', spread: 0.2, rooms: 9 },
      { id: 'b', spread: 0.6, rooms: 8 },
      { id: 'c', spread: 0.2, rooms: 20 },
    ]);
    expect(out.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });
});
