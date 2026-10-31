import { cache } from 'react';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { publicPieceUrl } from '@/lib/audit/types';
import {
  BALANCE_MIN_ROOMS_MOTION,
  SIZE_BINS,
  balanceByType,
  foldBalance,
  groupSides,
  type Balance,
  type RawBalanceRow,
} from '@/lib/admin/capturedMath';

/**
 * Read models for the Captured tab: what the stored tournaments look like in
 * aggregate (size, place, format and year, motion types, how fair the seats
 * were). Every reader leaves out tournaments an admin set to ignored (test
 * and demo ones), is one grouped query (or two) that returns at most a few
 * dozen rows however many tournaments are stored, and is cache()'d so a
 * render never asks twice. The tab guards each reader on its own
 * (components/admin/tabs/CapturedTab.tsx), so one failing leaves the others.
 *
 * All SQL is a Prisma.sql template: every value is a bound parameter, and the
 * only lists spliced in are made with Prisma.join from the stored seat
 * spellings, which are parameters too.
 */

/** The cut a tournament name or motion text is shown at in a list row. */
const TEXT_MAX = 160;
const clip = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1).trimEnd()}…` : s);

export type Count = { value: string | null; count: number };

/** A grouped count, biggest first, "none" (null) wherever it falls by size. */
function byCount(rows: Array<{ value: string | number | null; count: number }>): Count[] {
  return rows
    .map((r) => ({ value: r.value == null ? null : String(r.value), count: r.count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

// ── Size ────────────────────────────────────────────────────────────────

export type SizeStats = {
  /** Tournaments with at least one stored team: the sample of everything below. */
  sampled: number;
  /** Stored tournaments with no team row at all (not in the bins). */
  noTeams: number;
  /** Counts per SIZE_BINS entry, in order. */
  bins: number[];
  median: number | null;
  largest: Array<{ id: string; name: string; tabUrl: string | null; teams: number }>;
};

type SizeRow = {
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  sampled: number;
  median: number | null;
};

/**
 * Teams per tournament are the team standings rows (roundNumber 0), counted
 * per tournament in a CTE and binned by the SIZE_BINS bounds, so the page
 * reads one row of counts and a median, not a row per tournament.
 */
export const readSize = cache(async (): Promise<SizeStats> => {
  const [lo, mid, hi, top] = SIZE_BINS.slice(0, 4).map((b) => b.max);
  const [binned, largest, all] = await Promise.all([
    prisma.$queryRaw<SizeRow[]>(Prisma.sql`
      WITH sizes AS (
        SELECT COUNT(*)::int AS n
        FROM "Tournament" t
        JOIN "TeamResult" tr ON tr."tournamentId" = t.id AND tr."roundNumber" = 0
        WHERE t."ignored" = false
        GROUP BY t.id
      )
      SELECT
        COUNT(*) FILTER (WHERE n <= ${lo}::int)::int AS b0,
        COUNT(*) FILTER (WHERE n > ${lo}::int AND n <= ${mid}::int)::int AS b1,
        COUNT(*) FILTER (WHERE n > ${mid}::int AND n <= ${hi}::int)::int AS b2,
        COUNT(*) FILTER (WHERE n > ${hi}::int AND n <= ${top}::int)::int AS b3,
        COUNT(*) FILTER (WHERE n > ${top}::int)::int AS b4,
        COUNT(*)::int AS sampled,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY n))::float8 AS median
      FROM sizes`),
    prisma.$queryRaw<Array<{ id: string; name: string; url: string; teams: number }>>(Prisma.sql`
      SELECT t.id::text AS id, t.name, t."sourceUrlRaw" AS url, COUNT(*)::int AS teams
      FROM "Tournament" t
      JOIN "TeamResult" tr ON tr."tournamentId" = t.id AND tr."roundNumber" = 0
      WHERE t."ignored" = false
      GROUP BY t.id
      ORDER BY teams DESC, t.id
      LIMIT 10`),
    prisma.tournament.count({ where: { ignored: false } }),
  ]);
  const r = binned.at(0);
  const sampled = r?.sampled ?? 0;
  return {
    sampled,
    noTeams: Math.max(0, all - sampled),
    bins: r ? [r.b0, r.b1, r.b2, r.b3, r.b4] : SIZE_BINS.map(() => 0),
    median: r?.median ?? null,
    largest: largest.map((l) => ({
      id: l.id,
      name: clip(l.name),
      tabUrl: publicPieceUrl(l.url),
      teams: l.teams,
    })),
  };
});

// ── Geography, formats and years ────────────────────────────────────────

export type Grouped = { total: number; rows: Count[] };

/** Tournaments by approved region; the null row is "Unknown region". */
export const readGeography = cache(async (): Promise<Grouped> => {
  const g = await prisma.tournament.groupBy({
    by: ['region'],
    where: { ignored: false },
    _count: { _all: true },
  });
  const rows = byCount(g.map((r) => ({ value: r.region, count: r._count._all })));
  return { total: rows.reduce((a, r) => a + r.count, 0), rows };
});

export type FormatsYears = { total: number; formats: Count[]; years: Count[] };

/** Tournaments by format and by year; the null rows are "No format" and "No year". */
export const readFormatsYears = cache(async (): Promise<FormatsYears> => {
  const where = { ignored: false };
  const [f, y] = await Promise.all([
    prisma.tournament.groupBy({ by: ['format'], where, _count: { _all: true } }),
    prisma.tournament.groupBy({ by: ['year'], where, _count: { _all: true } }),
  ]);
  const formats = byCount(f.map((r) => ({ value: r.format, count: r._count._all })));
  // Years read newest first (a timeline), the unknown last.
  const years = byCount(y.map((r) => ({ value: r.year, count: r._count._all }))).sort((a, b) =>
    a.value == null ? 1 : b.value == null ? -1 : Number(b.value) - Number(a.value),
  );
  return { total: formats.reduce((a, r) => a + r.count, 0), formats, years };
});

// ── Motion types and topics ─────────────────────────────────────────────

export type MotionKinds = {
  total: number;
  types: Count[];
  topics: Count[];
  topicsUntagged: number;
};

/** How many topics the list shows; the rest are one "other topics" line in the caption. */
export const TOP_TOPICS = 10;

/** Motions by approved type, and the commonest topics. Null is "Untyped" / "No topic". */
export const readMotionKinds = cache(async (): Promise<MotionKinds> => {
  const where = { tournament: { ignored: false } };
  const [t, p] = await Promise.all([
    prisma.motion.groupBy({ by: ['motionType'], where, _count: { _all: true } }),
    prisma.motion.groupBy({ by: ['topic'], where, _count: { _all: true } }),
  ]);
  const types = byCount(t.map((r) => ({ value: r.motionType, count: r._count._all })));
  const allTopics = byCount(p.map((r) => ({ value: r.topic, count: r._count._all })));
  return {
    total: types.reduce((a, r) => a + r.count, 0),
    types,
    topics: allTopics.filter((r) => r.value != null).slice(0, TOP_TOPICS),
    topicsUntagged: allTopics.find((r) => r.value == null)?.count ?? 0,
  };
});

// ── Motion balance ──────────────────────────────────────────────────────

type BalanceSql = {
  position: string | null;
  type?: string;
  n: number;
  pointsRows: number;
  pointsSum: number;
  winRows: number;
  winSum: number;
};

const toRaw = (r: BalanceSql & { position: string }): RawBalanceRow => ({
  position: r.position,
  rows: r.n,
  pointsRows: r.pointsRows,
  pointsSum: r.pointsSum,
  winRows: r.winRows,
  winSum: r.winSum,
});

export type UnbalancedMotion = {
  motionId: string;
  text: string;
  roundLabel: string;
  tournament: { id: string; name: string; tabUrl: string | null };
  /** Points gap (BP) or distance of the Prop win share from one half (two-team). */
  spread: number;
  rooms: number;
  /** Per seat: average points (BP) or win share (two-team). */
  seats: Array<{ pos: string; value: number }>;
};

export type BalanceStats = {
  overall: Balance;
  /** Team-rounds with no recorded seat: kept out of every split here. */
  noSides: number;
  byType: {
    shown: Array<{ type: string; balance: Balance }>;
    tooFew: Array<{ type: string; rooms: number }>;
  };
  unbalancedBp: UnbalancedMotion[];
  unbalancedTwo: UnbalancedMotion[];
};

/** How long each most-unbalanced list is. */
export const UNBALANCED_LIMIT = 20;

type MotionSeatRow = {
  motion: string;
  pos: string[];
  vals: number[];
  rooms: number;
  spread: number;
};

/**
 * Prelim rounds only: TeamResult keeps no outrounds, and its round 0 is the
 * standings row, so `roundNumber > 0` is every prelim team-round. A motion is
 * tied to a round only where the round had exactly one motion (a
 * motion-per-room round cannot say which motion a team-round was on), which
 * the `one` CTE enforces.
 */
const SINGLE_MOTION_ROUNDS = Prisma.sql`
  SELECT m."tournamentId" AS tid, m."roundNumber" AS rn,
         MAX(m.id) AS mid, MAX(m."motionType") AS mt
  FROM "Motion" m
  JOIN "Tournament" t ON t.id = m."tournamentId"
  WHERE t."ignored" = false AND m."roundNumber" IS NOT NULL
  GROUP BY m."tournamentId", m."roundNumber"
  HAVING COUNT(*) = 1`;

export const readBalance = cache(async (): Promise<BalanceStats> => {
  const [overallRows, typeRows] = await Promise.all([
    prisma.$queryRaw<BalanceSql[]>(Prisma.sql`
      SELECT tr."position" AS position, COUNT(*)::int AS n,
             COUNT(tr.points)::int AS "pointsRows", COALESCE(SUM(tr.points), 0)::float8 AS "pointsSum",
             COUNT(tr.wins)::int AS "winRows", COALESCE(SUM(tr.wins), 0)::int AS "winSum"
      FROM "TeamResult" tr
      JOIN "Tournament" t ON t.id = tr."tournamentId"
      WHERE t."ignored" = false AND tr."roundNumber" > 0
      GROUP BY tr."position"`),
    prisma.$queryRaw<BalanceSql[]>(Prisma.sql`
      WITH one AS (${SINGLE_MOTION_ROUNDS})
      SELECT COALESCE(one.mt, '') AS type, tr."position" AS position, COUNT(*)::int AS n,
             COUNT(tr.points)::int AS "pointsRows", COALESCE(SUM(tr.points), 0)::float8 AS "pointsSum",
             COUNT(tr.wins)::int AS "winRows", COALESCE(SUM(tr.wins), 0)::int AS "winSum"
      FROM "TeamResult" tr
      JOIN one ON one.tid = tr."tournamentId" AND one.rn = tr."roundNumber"
      WHERE tr."position" IS NOT NULL
      GROUP BY one.mt, tr."position"`),
  ]);

  const seated = overallRows.flatMap((r) =>
    r.position == null ? [] : [toRaw({ ...r, position: r.position })],
  );
  const noSides = overallRows.find((r) => r.position == null)?.n ?? 0;
  const sides = groupSides(seated.map((r) => r.position));

  const [unbalancedBp, unbalancedTwo] = await Promise.all([
    readUnbalancedBp(sides.OG.concat(sides.OO, sides.CG, sides.CO)),
    readUnbalancedTwo(sides.Prop, sides.Opp),
  ]);

  return {
    overall: foldBalance(seated),
    noSides,
    byType: balanceByType(
      typeRows.flatMap((r) =>
        r.position == null
          ? []
          : [{ ...toRaw({ ...r, position: r.position }), type: r.type ?? '' }],
      ),
    ),
    unbalancedBp,
    unbalancedTwo,
  };
});

/**
 * BP motions whose four seats averaged furthest apart. Per motion and seat the
 * database averages points; the motion needs all four seats, each with at
 * least BALANCE_MIN_ROOMS_MOTION rooms, and its spread is best minus worst.
 */
async function readUnbalancedBp(seats: string[]): Promise<UnbalancedMotion[]> {
  if (seats.length === 0) return [];
  const rows = await prisma.$queryRaw<MotionSeatRow[]>(Prisma.sql`
    WITH one AS (${SINGLE_MOTION_ROUNDS}),
    seat AS (
      SELECT one.mid, tr."position" AS pos, AVG(tr.points)::float8 AS val, COUNT(tr.points)::int AS n
      FROM "TeamResult" tr
      JOIN one ON one.tid = tr."tournamentId" AND one.rn = tr."roundNumber"
      WHERE tr."position" IN (${Prisma.join(seats)}) AND tr.points IS NOT NULL
      GROUP BY one.mid, tr."position"
    )
    SELECT mid::text AS motion, array_agg(pos ORDER BY pos) AS pos, array_agg(val ORDER BY pos) AS vals,
           MIN(n)::int AS rooms, (MAX(val) - MIN(val))::float8 AS spread
    FROM seat
    GROUP BY mid
    HAVING COUNT(*) = 4 AND MIN(n) >= ${BALANCE_MIN_ROOMS_MOTION}
    ORDER BY spread DESC, rooms DESC
    LIMIT ${UNBALANCED_LIMIT}`);
  return withMotions(rows);
}

/**
 * Two-team motions whose Prop win share sits furthest from one half. The
 * motion needs both sides with at least BALANCE_MIN_ROOMS_MOTION recorded
 * results each.
 */
async function readUnbalancedTwo(prop: string[], opp: string[]): Promise<UnbalancedMotion[]> {
  if (prop.length === 0 || opp.length === 0) return [];
  const rows = await prisma.$queryRaw<MotionSeatRow[]>(Prisma.sql`
    WITH one AS (${SINGLE_MOTION_ROUNDS}),
    seat AS (
      SELECT one.mid,
             CASE WHEN tr."position" IN (${Prisma.join(prop)}) THEN 'Prop' ELSE 'Opp' END AS pos,
             AVG(tr.wins)::float8 AS val, COUNT(tr.wins)::int AS n
      FROM "TeamResult" tr
      JOIN one ON one.tid = tr."tournamentId" AND one.rn = tr."roundNumber"
      WHERE tr."position" IN (${Prisma.join([...prop, ...opp])}) AND tr.wins IS NOT NULL
      GROUP BY one.mid, 2
    )
    SELECT mid::text AS motion, array_agg(pos ORDER BY pos) AS pos, array_agg(val ORDER BY pos) AS vals,
           MIN(n)::int AS rooms,
           ABS(MAX(val) FILTER (WHERE pos = 'Prop') - 0.5)::float8 AS spread
    FROM seat
    GROUP BY mid
    HAVING COUNT(*) = 2 AND MIN(n) >= ${BALANCE_MIN_ROOMS_MOTION}
    ORDER BY spread DESC, rooms DESC
    LIMIT ${UNBALANCED_LIMIT}`);
  return withMotions(rows);
}

/** The motions' text and tournaments for the listed rows, one query for all. */
async function withMotions(rows: MotionSeatRow[]): Promise<UnbalancedMotion[]> {
  if (rows.length === 0) return [];
  const motions = await prisma.motion.findMany({
    where: { id: { in: rows.map((r) => BigInt(r.motion)) } },
    select: {
      id: true,
      text: true,
      roundLabel: true,
      tournament: { select: { id: true, name: true, sourceUrlRaw: true } },
    },
  });
  const byId = new Map(motions.map((m) => [String(m.id), m]));
  return rows.flatMap((r) => {
    const m = byId.get(r.motion);
    if (!m) return [];
    return [
      {
        motionId: r.motion,
        text: clip(m.text),
        roundLabel: m.roundLabel,
        tournament: {
          id: String(m.tournament.id),
          name: clip(m.tournament.name),
          tabUrl: publicPieceUrl(m.tournament.sourceUrlRaw),
        },
        spread: r.spread,
        rooms: r.rooms,
        seats: r.pos.map((pos, i) => ({ pos, value: r.vals[i] ?? 0 })),
      },
    ];
  });
}

// ── Coverage gaps ───────────────────────────────────────────────────────

/** Tournaments that keep a page back (withheld or never published), not ignored. */
export const countUnreleased = cache(() =>
  prisma.tournament.count({
    where: { ignored: false, scrapePieces: { some: { status: 'withheld' } } },
  }),
);
