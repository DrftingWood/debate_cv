import { IngestJobStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';

/**
 * Read model for the admin scrape-health and tournament-pieces pages. Counts
 * come from the database (a count per question) so they stay right however
 * many pieces are failing; only the lists shown are capped.
 */

const LIST_CAP = 200;

export type FailedPiece = {
  kind: PieceKind;
  key: string;
  label: string;
  httpStatus: number | null;
  attempts: number;
  nextRetryAt: Date | null;
};

export type ScrapeHealth = {
  tracked: number;
  partlyLoaded: number;
  failingPieces: number;
  retriesDue: number;
  stuck: number;
  failingByKind: Array<{ kind: PieceKind; count: number }>;
  partlyLoadedTournaments: Array<{
    id: bigint;
    name: string;
    failed: FailedPiece[];
    lastAttemptAt: Date;
  }>;
  failedJobs: Array<{
    id: string;
    url: string;
    userEmail: string | null;
    attempts: number;
    lastError: string | null;
    finishedAt: Date | null;
  }>;
};

async function loadFailedJobs() {
  return prisma.ingestJob.findMany({
    where: { status: { in: [IngestJobStatus.failed, IngestJobStatus.abandoned] } },
    orderBy: { finishedAt: { sort: 'desc', nulls: 'last' } },
    take: LIST_CAP,
    select: {
      id: true,
      url: true,
      attempts: true,
      lastError: true,
      finishedAt: true,
      user: { select: { email: true } },
    },
  });
}

async function loadFailedDetail(ids: bigint[]) {
  if (ids.length === 0) return { pieces: [], tournaments: [] };
  const [pieces, tournaments] = await Promise.all([
    prisma.scrapePiece.findMany({
      where: { status: 'failed', tournamentId: { in: ids } },
      orderBy: [{ kind: 'asc' }, { key: 'asc' }],
      select: {
        tournamentId: true,
        kind: true,
        key: true,
        label: true,
        httpStatus: true,
        attempts: true,
        nextRetryAt: true,
      },
    }),
    prisma.tournament.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    }),
  ]);
  return { pieces, tournaments };
}

export async function getScrapeHealth(): Promise<ScrapeHealth> {
  const now = new Date();
  const failed = { status: 'failed' };
  const [tracked, failingPieces, retriesDue, stuck, byKind, byTournament, failedJobRows] =
    await Promise.all([
      prisma.tournament.count({ where: { scrapePieces: { some: {} } } }),
      prisma.scrapePiece.count({ where: failed }),
      prisma.scrapePiece.count({ where: { ...failed, nextRetryAt: { lte: now } } }),
      // Null nextRetryAt means retries are exhausted: only a person can move it.
      prisma.scrapePiece.count({ where: { ...failed, nextRetryAt: null } }),
      prisma.scrapePiece.groupBy({ by: ['kind'], where: failed, _count: { _all: true } }),
      prisma.scrapePiece.groupBy({
        by: ['tournamentId'],
        where: failed,
        _max: { lastAttemptAt: true },
      }),
      loadFailedJobs(),
    ]);

  const newest = byTournament
    .map((g) => ({ id: g.tournamentId, lastAttemptAt: g._max.lastAttemptAt ?? new Date(0) }))
    .sort((a, b) => b.lastAttemptAt.getTime() - a.lastAttemptAt.getTime())
    .slice(0, LIST_CAP);
  const ids = newest.map((t) => t.id);

  const { pieces, tournaments } = await loadFailedDetail(ids);
  const nameById = new Map(tournaments.map((t) => [t.id, t.name] as const));

  return {
    tracked,
    partlyLoaded: byTournament.length,
    failingPieces,
    retriesDue,
    stuck,
    failingByKind: byKind.map((g) => ({ kind: g.kind as PieceKind, count: g._count._all })),
    partlyLoadedTournaments: newest.map((t) => ({
      id: t.id,
      name: nameById.get(t.id) ?? `Tournament ${t.id}`,
      lastAttemptAt: t.lastAttemptAt,
      failed: pieces
        .filter((p) => p.tournamentId === t.id)
        .map((p) => ({
          kind: p.kind as PieceKind,
          key: p.key,
          label: p.label,
          httpStatus: p.httpStatus,
          attempts: p.attempts,
          nextRetryAt: p.nextRetryAt,
        })),
    })),
    failedJobs: failedJobRows.map((j) => ({
      id: j.id,
      url: j.url,
      userEmail: j.user.email,
      attempts: j.attempts,
      lastError: j.lastError,
      finishedAt: j.finishedAt,
    })),
  };
}

export type PieceRow = {
  kind: PieceKind;
  key: string;
  label: string;
  status: 'ok' | 'failed';
  httpStatus: number | null;
  attempts: number;
  loadedAt: Date | null;
  lastAttemptAt: Date;
  nextRetryAt: Date | null;
  lastError: string | null;
};

/** Numeric round keys ascending, then the outrounds (non-numeric keys) by label. */
function compareRounds(a: PieceRow, b: PieceRow): number {
  const an = /^\d+$/.test(a.key) ? Number(a.key) : null;
  const bn = /^\d+$/.test(b.key) ? Number(b.key) : null;
  if (an != null && bn != null) return an - bn;
  if (an != null) return -1;
  if (bn != null) return 1;
  return a.label.localeCompare(b.label);
}

export async function getTournamentPieces(id: bigint): Promise<{
  tournament: { id: bigint; name: string; sourceUrl: string };
  tabs: PieceRow[];
  rounds: PieceRow[];
} | null> {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: { id: true, name: true, sourceUrlRaw: true },
  });
  if (!t) return null;
  const rows = await prisma.scrapePiece.findMany({
    where: { tournamentId: id },
    select: {
      kind: true,
      key: true,
      label: true,
      status: true,
      httpStatus: true,
      attempts: true,
      loadedAt: true,
      lastAttemptAt: true,
      nextRetryAt: true,
      lastError: true,
    },
  });
  const all: PieceRow[] = rows.map((r) => ({
    ...r,
    kind: r.kind as PieceKind,
    status: r.status as PieceRow['status'],
  }));
  return {
    tournament: { id: t.id, name: t.name, sourceUrl: t.sourceUrlRaw },
    tabs: all.filter((p) => p.kind !== 'round'),
    rounds: all.filter((p) => p.kind === 'round').sort(compareRounds),
  };
}
