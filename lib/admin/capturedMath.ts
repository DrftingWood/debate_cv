import { canonicalPosition } from '@/lib/cv/speakerStats';

/**
 * The arithmetic of the Captured tab. The queries only group and count; every
 * figure the owner reads (a bin, a median, a seat's average, a spread) is
 * decided here, in plain functions that take numbers, so each can be tested
 * with real values and the SQL stays dull.
 */

/** Team-count bins, the owner's list (R11). `max` is inclusive; the last is open. */
export const SIZE_BINS = [
  { label: '≤16', max: 16 },
  { label: '17–32', max: 32 },
  { label: '33–64', max: 64 },
  { label: '65–128', max: 128 },
  { label: '129+', max: Infinity },
] as const;

/** The bin a tournament of `teams` teams falls in. */
export function sizeBinIndex(teams: number): number {
  const i = SIZE_BINS.findIndex((b) => teams <= b.max);
  return i === -1 ? SIZE_BINS.length - 1 : i;
}

/** How many of `sizes` fall in each bin. */
export function binCounts(sizes: readonly number[]): number[] {
  const out = SIZE_BINS.map(() => 0);
  for (const s of sizes) out[sizeBinIndex(s)] += 1;
  return out;
}

/** The median of a list; null when it is empty. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A type needs this many rooms before its split is shown (the owner's rule). */
export const BALANCE_MIN_ROOMS_TYPE = 30;
/** A motion needs this many rooms before it can be called unbalanced. */
export const BALANCE_MIN_ROOMS_MOTION = 8;

export const BP_SEATS = ['OG', 'OO', 'CG', 'CO'] as const;
export const TWO_SEATS = ['Prop', 'Opp'] as const;
export type BpSeat = (typeof BP_SEATS)[number];
export type TwoSeat = (typeof TWO_SEATS)[number];

/** The order seats are always read in: the four BP seats, then the two sides. */
const SEAT_ORDER: readonly string[] = [...BP_SEATS, ...TWO_SEATS];

/** Seats in the fixed reading order; the database hands them back alphabetically. */
export function orderSeats<T extends { pos: string }>(seats: readonly T[]): T[] {
  const rank = (pos: string) => {
    const i = SEAT_ORDER.indexOf(pos);
    return i === -1 ? SEAT_ORDER.length : i;
  };
  return [...seats].sort((a, b) => rank(a.pos) - rank(b.pos));
}

export type Sides = Record<BpSeat | TwoSeat, string[]> & { unknown: string[] };

/**
 * The stored `position` spellings, sorted into canonical seats. The stored
 * column holds whatever the results page said ("OG", "Opening Government",
 * "Gov"), so the queries filter on these lists of spellings rather than on a
 * second, hand-copied mapping in SQL.
 */
export function groupSides(raw: readonly string[]): Sides {
  const out: Sides = { OG: [], OO: [], CG: [], CO: [], Prop: [], Opp: [], unknown: [] };
  for (const r of raw) {
    const c = canonicalPosition(r);
    if (c === 'OG' || c === 'OO' || c === 'CG' || c === 'CO' || c === 'Prop' || c === 'Opp') {
      out[c].push(r);
    } else out.unknown.push(r);
  }
  return out;
}

/** One group of team-rounds the database counted: a stored seat spelling. */
export type RawBalanceRow = {
  position: string;
  /** Team-rounds with this seat. */
  rows: number;
  /** Of them, those with points, and the points' sum. */
  pointsRows: number;
  pointsSum: number;
  /** Of them, those with a win recorded, and how many won. */
  winRows: number;
  winSum: number;
};

export type BpSplit = { pos: BpSeat; n: number; avg: number | null };
export type TwoSplit = { pos: TwoSeat; n: number; share: number | null };

export type Balance = {
  bp: { positions: BpSplit[]; rooms: number; spread: number | null };
  two: { positions: TwoSplit[]; rooms: number; spread: number | null };
  /** Team-rounds whose seat is none of the six; in neither split. */
  unrecognised: number;
};

const spreadOf = (values: Array<number | null>): number | null => {
  const v = values.filter((x): x is number => x != null);
  return v.length < 2 ? null : Math.max(...v) - Math.min(...v);
};

/**
 * Folds the groups into the BP split (average points per seat) and the
 * two-team split (win share per side). A BP room has four team-rounds and a
 * two-team room two, so the rooms are the points-bearing (or win-bearing)
 * team-rounds divided down. The spread is the gap between the best and worst
 * seat: in points for BP, in win share for two-team.
 */
export function foldBalance(rows: readonly RawBalanceRow[]): Balance {
  const sides = groupSides(rows.map((r) => r.position));
  const seatOf = new Map<string, BpSeat | TwoSeat>();
  for (const seat of [...BP_SEATS, ...TWO_SEATS]) for (const s of sides[seat]) seatOf.set(s, seat);
  const sum = new Map<BpSeat | TwoSeat, RawBalanceRow>();
  let unrecognised = 0;
  for (const r of rows) {
    const seat = seatOf.get(r.position);
    if (!seat) {
      unrecognised += r.rows;
      continue;
    }
    const cur = sum.get(seat) ?? {
      position: seat,
      rows: 0,
      pointsRows: 0,
      pointsSum: 0,
      winRows: 0,
      winSum: 0,
    };
    cur.rows += r.rows;
    cur.pointsRows += r.pointsRows;
    cur.pointsSum += r.pointsSum;
    cur.winRows += r.winRows;
    cur.winSum += r.winSum;
    sum.set(seat, cur);
  }
  const bp = BP_SEATS.map((pos): BpSplit => {
    const s = sum.get(pos);
    return {
      pos,
      n: s?.pointsRows ?? 0,
      avg: s && s.pointsRows > 0 ? s.pointsSum / s.pointsRows : null,
    };
  });
  const two = TWO_SEATS.map((pos): TwoSplit => {
    const s = sum.get(pos);
    return { pos, n: s?.winRows ?? 0, share: s && s.winRows > 0 ? s.winSum / s.winRows : null };
  });
  return {
    bp: {
      positions: bp,
      rooms: Math.round(bp.reduce((a, p) => a + p.n, 0) / 4),
      spread: spreadOf(bp.map((p) => p.avg)),
    },
    two: {
      positions: two,
      rooms: Math.round(two.reduce((a, p) => a + p.n, 0) / 2),
      spread: spreadOf(two.map((p) => p.share)),
    },
    unrecognised,
  };
}

/**
 * The split per motion type. A type with fewer rooms than the threshold (BP
 * and two-team rooms together) is not shown as a split, only listed with its
 * room count for each kind, so a handful of rooms cannot read as a finding.
 */
export function balanceByType(rows: ReadonlyArray<RawBalanceRow & { type: string }>) {
  const types = [...new Set(rows.map((r) => r.type))];
  const shown: Array<{ type: string; balance: Balance }> = [];
  const tooFew: Array<{ type: string; bp: number; two: number }> = [];
  for (const type of types) {
    const balance = foldBalance(rows.filter((r) => r.type === type));
    // Each kind of room is judged on its own: 25 four-team rooms and 25
    // two-team rooms are two small samples, not one of 50.
    if (Math.max(balance.bp.rooms, balance.two.rooms) >= BALANCE_MIN_ROOMS_TYPE)
      shown.push({ type, balance });
    else tooFew.push({ type, bp: balance.bp.rooms, two: balance.two.rooms });
  }
  const roomsOf = (t: { balance: Balance }) => t.balance.bp.rooms + t.balance.two.rooms;
  shown.sort((a, b) => roomsOf(b) - roomsOf(a));
  tooFew.sort((a, b) => b.bp + b.two - (a.bp + a.two));
  return { shown, tooFew };
}

/** Most unbalanced first; of equal spread, the one with more rooms behind it. */
export function sortedByUnbalance<T extends { spread: number; rooms: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => b.spread - a.spread || b.rooms - a.rooms);
}
