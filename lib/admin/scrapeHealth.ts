import { prisma } from '@/lib/db';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import { storedMatchesByUrl, type StoredRef } from '@/lib/admin/tournamentLookup';

/**
 * Read model for a tournament's scrape pieces, and the matching of failed
 * import jobs to stored tournaments (matchJobs, used by the Inbox, the
 * Imports tab and the review set). The failed-imports list itself is
 * lib/admin/importsList.ts.
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
  tournament: { id: bigint; name: string; sourceUrl: string; ignored: boolean };
  tabs: PieceRow[];
  rounds: PieceRow[];
} | null> {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: { id: true, name: true, sourceUrlRaw: true, ignored: true },
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
    tournament: { id: t.id, name: t.name, sourceUrl: t.sourceUrlRaw, ignored: t.ignored },
    tabs: all.filter((p) => p.kind !== 'round'),
    rounds: all.filter((p) => p.kind === 'round').sort(compareRounds),
  };
}
