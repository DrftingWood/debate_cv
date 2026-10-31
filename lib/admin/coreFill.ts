import * as Sentry from '@sentry/nextjs';
import { prisma } from '@/lib/db';
import { runAudit } from '@/lib/audit/run';
import type { rescrapePieces } from '@/lib/calicotab/partialScrape';
import type { PieceRef } from '@/lib/calicotab/scrapePieces';
import { CORE_BATCH_SIZE, type CoreFillResponse } from '@/lib/admin/coreFillText';

/**
 * "Fill missing adjudication cores": for tournaments that name no core, read
 * the home page's Tournament Staff block (and the participants list, when it
 * was never read) through the ordinary partial re-scrape, never a full
 * re-ingest. Each tournament costs a fetch of its public landing page, so a
 * press is bounded: CORE_BATCH_SIZE tournaments, or fewer if the time runs
 * out, continuing from a cursor on the next press.
 *
 * The pool is every tournament with no staff-block name, no Adj Core judge,
 * and no home piece already read: one whose home page was read and named
 * nobody has had its answer and leaves the pool (its check still warns, and
 * a Fix can read it again). A tournament that withholds its participants list
 * is left out too, since the check does not apply to it.
 */

/** Time kept back at the end of a press to re-audit what it filled. */
const TAIL_MS = 10_000;
/** Re-audit chunk size, run.ts's sweep size. */
const AUDIT_CHUNK = 25;

const HOME: PieceRef = { kind: 'home', key: '' };
const PARTICIPANTS: PieceRef = { kind: 'participants', key: '' };

/** Tournaments the fill still has to look at, after `after` by id. */
export function missingCoreWhere(after: bigint | null) {
  return {
    // Test and demo tournaments an admin set to ignored are not offered.
    ignored: false,
    staff: { none: { role: 'core' } },
    participants: { none: { judgeTypeTag: { equals: 'core', mode: 'insensitive' as const } } },
    scrapePieces: {
      none: {
        OR: [
          { kind: 'home', status: 'ok' },
          { kind: 'participants', status: 'withheld' },
          { kind: 'home', status: 'withheld' },
        ],
      },
    },
    ...(after != null ? { id: { gt: after } } : {}),
  };
}

/** Tournaments the Tools tab says are waiting. */
export function countMissingCores(): Promise<number> {
  return prisma.tournament.count({ where: missingCoreWhere(null) });
}

/** Of these tournaments, those whose participants list is on record (a piece that loaded, or judges stored). */
async function participantsRead(ids: bigint[]): Promise<Set<bigint>> {
  const [pieces, judges] = await Promise.all([
    prisma.scrapePiece.findMany({
      where: { tournamentId: { in: ids }, kind: 'participants', status: 'ok' },
      select: { tournamentId: true },
    }),
    prisma.tournamentParticipant.groupBy({
      by: ['tournamentId'],
      where: { tournamentId: { in: ids }, roles: { some: { role: 'judge' } } },
      _count: { _all: true },
    }),
  ]);
  return new Set([...pieces, ...judges].map((r) => r.tournamentId));
}

/** Whether anyone is named core now, by either source. */
async function namesCore(id: bigint): Promise<boolean> {
  const [staff, ticked] = await Promise.all([
    prisma.tournamentStaff.count({ where: { tournamentId: id, role: 'core' } }),
    prisma.tournamentParticipant.count({
      where: { tournamentId: id, judgeTypeTag: { equals: 'core', mode: 'insensitive' } },
    }),
  ]);
  return staff + ticked > 0;
}

/**
 * One press. `rescrape` is injectable for tests. `deadline` is an absolute
 * time (ms); the loop stops starting tournaments when little of it is left.
 */
export async function fillMissingCores(
  after: bigint | null,
  opts: { deadline?: number; rescrape?: typeof rescrapePieces } = {},
): Promise<CoreFillResponse> {
  // Loaded when a press runs, not when the Tools tab renders: the ingest
  // code behind it is large and the tab only needs the count above.
  const rescrape = opts.rescrape ?? (await import('@/lib/calicotab/partialScrape')).rescrapePieces;
  const batch = await prisma.tournament.findMany({
    where: missingCoreWhere(after),
    orderBy: { id: 'asc' },
    take: CORE_BATCH_SIZE,
    select: { id: true },
  });
  if (batch.length === 0) return { found: 0, none: 0, failed: 0, left: 0, next: null };

  const read = await participantsRead(batch.map((b) => b.id));
  const out = { found: 0, none: 0, failed: 0 };
  const audited: bigint[] = [];
  let last = after ?? 0n;
  for (const { id } of batch) {
    if (opts.deadline != null && Date.now() >= opts.deadline - TAIL_MS) break;
    last = id;
    try {
      const pieces = read.has(id) ? [HOME] : [HOME, PARTICIPANTS];
      const r = await rescrape(id, pieces, { deadline: opts.deadline });
      // A home page the tournament has taken down (withheld) is an answer, not
      // a failure: nothing there names a core.
      if (r.notOnTab.some((p) => p.kind === 'home')) {
        out.none += 1;
      } else if (!r.loaded.some((p) => p.kind === 'home')) {
        out.failed += 1;
      } else if (await namesCore(id)) {
        out.found += 1;
      } else {
        out.none += 1;
      }
      audited.push(id);
    } catch (err) {
      // A busy or unreachable tournament is a failure of this press, nothing
      // more; only the unexpected is reported, and by code, not by message.
      const name = (err as { name?: string }).name;
      if (name !== 'ScrapeBusyError' && name !== 'TournamentNotFoundError') {
        Sentry.captureException(err, { tags: { route: 'api/admin/cores', stage: 'fill' } });
      }
      out.failed += 1;
    }
  }
  for (let i = 0; i < audited.length; i += AUDIT_CHUNK) {
    await runAudit(audited.slice(i, i + AUDIT_CHUNK));
  }
  const left = await prisma.tournament.count({ where: missingCoreWhere(last) });
  return { ...out, left, next: left > 0 ? String(last) : null };
}
