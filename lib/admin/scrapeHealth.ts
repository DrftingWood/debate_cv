import { IngestJobStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import { publicPieceUrl } from '@/lib/audit/types';
import { storedMatchesByUrl, type StoredRef } from '@/lib/admin/tournamentLookup';
import {
  ambiguousTab,
  loadTabStates,
  tabState,
  UNMATCHABLE_TAB,
  type TabState,
} from '@/lib/admin/tabStatus';
import { parseTabAddress } from '@/lib/admin/tabAddress';

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
  /**
   * Pieces the tournament itself withholds (status 'withheld'): never
   * retried and not failing, so counted apart from everything below.
   */
  withheld: number;
  partlyLoaded: number;
  failingPieces: number;
  retriesDue: number;
  stuck: number;
  failingByKind: Array<{ kind: PieceKind; count: number }>;
  partlyLoadedTournaments: Array<{
    id: bigint;
    name: string;
    /**
     * The public tab address, made public HERE: these rows feed a client
     * table, and anything a client component is handed is serialised into
     * the page, so a stored private URL must never get that far.
     */
    tabUrl: string | null;
    /** For the "In database" cell: when the tournament was last scraped. */
    scrapedAt: Date | null;
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
    /** The stored tournament this URL belongs to, or null (the "In database" cell). */
    stored: StoredRef | null;
    /** How much of that tournament's tab loaded (the "Tab" cell), its errors in words. */
    tab: TabState;
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
      userId: true,
      user: { select: { email: true } },
    },
  });
}

/**
 * The stored tournament behind each failed job, keyed by job id. A job whose
 * DiscoveredUrl was linked to a tournament (an earlier import of it worked)
 * uses that link; the rest are matched by host and slug in one batched
 * query, which is how a never-imported private URL of a pre-scraped
 * tournament is found.
 */
/** A user's URL as one map key; NUL cannot occur in either part. */
const jobKey = (j: { userId: string; url: string }) => `${j.userId}\u0000${j.url}`;

export async function storedForJobs(
  jobs: Array<{ id: string; userId: string; url: string }>,
): Promise<Map<string, StoredRef>> {
  return (await matchJobs(jobs)).stored;
}

/**
 * storedForJobs, plus the jobs whose address matched two or more stored
 * rows (by job id, with how many) and no DiscoveredUrl link settles it.
 * Their Tab cell reads "? Check", not a false "✗ Not loaded" (Task 5d).
 */
export async function matchJobs(
  jobs: Array<{ id: string; userId: string; url: string }>,
): Promise<{ stored: Map<string, StoredRef>; ambiguous: Map<string, number> }> {
  if (jobs.length === 0) return { stored: new Map(), ambiguous: new Map() };
  const urls = [...new Set(jobs.map((j) => j.url))];
  const [links, byUrl] = await Promise.all([
    prisma.discoveredUrl.findMany({
      where: {
        tournamentId: { not: null },
        url: { in: urls },
        userId: { in: [...new Set(jobs.map((j) => j.userId))] },
      },
      select: {
        userId: true,
        url: true,
        tournament: { select: { id: true, name: true, scrapedAt: true } },
      },
    }),
    storedMatchesByUrl(urls),
  ]);
  const linked = new Map<string, StoredRef>();
  for (const l of links) {
    if (!l.tournament) continue;
    const { id, name, scrapedAt } = l.tournament;
    linked.set(jobKey(l), { id: id.toString(), name, scrapedAt });
  }
  const stored = new Map<string, StoredRef>();
  const ambiguous = new Map<string, number>();
  for (const j of jobs) {
    const ref = linked.get(jobKey(j)) ?? byUrl.stored.get(j.url);
    if (ref) stored.set(j.id, ref);
    else if (byUrl.ambiguous.has(j.url)) ambiguous.set(j.id, byUrl.ambiguous.get(j.url) ?? 2);
  }
  return { stored, ambiguous };
}

/**
 * The failed-imports list, each job with its stored tournament (or null) and
 * how much of that tournament's tab loaded. The Tab states take one more
 * query, for the stored tournaments only.
 */
async function loadFailedJobsStored(): Promise<ScrapeHealth['failedJobs']> {
  const jobs = await loadFailedJobs();
  const { stored: storedByJob, ambiguous } = await matchJobs(jobs);
  const tabs = await loadTabStates([...storedByJob.values()].map((r) => r.id));
  // Not stored, as far as can be told: two stored rows on its address, or
  // a tab-site address with no slug to match on, is "? Check" (in both the
  // Tab and the In database cells), not a false "✗ Not loaded".
  const tabOf = (j: { id: string; url: string }): TabState => {
    const ref = storedByJob.get(j.id);
    if (ref) return tabs.get(ref.id) ?? tabState(ref.id, []);
    const n = ambiguous.get(j.id);
    if (n) return ambiguousTab(n);
    const address = parseTabAddress(j.url);
    return address && !address.slug ? UNMATCHABLE_TAB : tabState(null, []);
  };
  return jobs.map((j) => ({
    id: j.id,
    url: j.url,
    userEmail: j.user.email,
    attempts: j.attempts,
    lastError: j.lastError,
    finishedAt: j.finishedAt,
    stored: storedByJob.get(j.id) ?? null,
    tab: tabOf(j),
  }));
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
      select: { id: true, name: true, sourceUrlRaw: true, scrapedAt: true },
    }),
  ]);
  return { pieces, tournaments };
}

export async function getScrapeHealth(): Promise<ScrapeHealth> {
  const now = new Date();
  const failed = { status: 'failed' };
  const [tracked, withheld, failingPieces, retriesDue, stuck, byKind, byTournament, failedJobRows] =
    await Promise.all([
      prisma.tournament.count({ where: { scrapePieces: { some: {} } } }),
      prisma.scrapePiece.count({ where: { status: 'withheld' } }),
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
      loadFailedJobsStored(),
    ]);

  const newest = byTournament
    .map((g) => ({ id: g.tournamentId, lastAttemptAt: g._max.lastAttemptAt ?? new Date(0) }))
    .sort((a, b) => b.lastAttemptAt.getTime() - a.lastAttemptAt.getTime())
    .slice(0, LIST_CAP);
  const ids = newest.map((t) => t.id);

  const { pieces, tournaments } = await loadFailedDetail(ids);
  const byId = new Map(tournaments.map((t) => [t.id, t] as const));

  return {
    tracked,
    withheld,
    partlyLoaded: byTournament.length,
    failingPieces,
    retriesDue,
    stuck,
    failingByKind: byKind.map((g) => ({ kind: g.kind as PieceKind, count: g._count._all })),
    partlyLoadedTournaments: newest.map((t) => ({
      id: t.id,
      name: byId.get(t.id)?.name ?? `Tournament ${t.id}`,
      tabUrl: publicPieceUrl(byId.get(t.id)?.sourceUrlRaw ?? ''),
      scrapedAt: byId.get(t.id)?.scrapedAt ?? null,
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
    failedJobs: failedJobRows,
  };
}

export type PieceRow = {
  kind: PieceKind;
  key: string;
  label: string;
  status: 'ok' | 'failed' | 'withheld';
  httpStatus: number | null;
  attempts: number;
  loadedAt: Date | null;
  lastAttemptAt: Date;
  nextRetryAt: Date | null;
  lastError: string | null;
  /** Why a withheld piece is withheld; 'not_published' reads "Not published". */
  reason?: string | null;
  /**
   * The page's address as stored: it may be a private URL, so it only
   * leaves the server through toPieceCard, which makes it public.
   */
  url?: string | null;
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
      reason: true,
      url: true,
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
