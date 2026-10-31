import * as Sentry from '@sentry/nextjs';
import { prisma } from '@/lib/db';
import { runAudit } from '@/lib/audit/run';
import { PARSER_VERSION } from '@/lib/calicotab/version';
import type { rescrapePieces } from '@/lib/calicotab/partialScrape';
import type { PieceRef } from '@/lib/calicotab/scrapePieces';
import { OLD_PARSER_BATCH_SIZE, type OldParserResponse } from '@/lib/admin/oldParserText';

/**
 * "Refresh old-parser tournaments": a tournament whose stored data came from
 * an older PARSER_VERSION is brought up to date by re-reading every page it
 * has on record through the ordinary partial re-scrape, never a full
 * re-ingest. Each tournament costs a fetch per recorded page, so a press is
 * bounded: OLD_PARSER_BATCH_SIZE tournaments, or fewer if the time runs out,
 * continuing from a cursor on the next press.
 *
 * "Older" is the tournament's own stamp (Tournament.parserVersion, the one
 * the cache check and the Old parser check both read), not a ParserRun row:
 * a run is per fetched document, and one tournament has many. A tournament
 * with no stamp is not in the pool (nothing says it is old, and its Old
 * parser warning stays for a full re-scrape), nor is one with no recorded
 * page (there is nothing to re-read) nor an ignored one.
 *
 * A partial re-scrape does not move the stamp, so this does it, and only when
 * every recorded page loaded or is no longer linked: a tournament with a
 * failed page keeps its old stamp and is offered again.
 */

/** Time kept back at the end of a press to re-audit what it refreshed. */
const TAIL_MS = 10_000;
/** Re-audit chunk size, run.ts's sweep size. */
const AUDIT_CHUNK = 25;

/** Tournaments the refresh still has to look at, after `after` by id. */
export function oldParserWhere(after: bigint | null) {
  return {
    ignored: false,
    parserVersion: { lt: PARSER_VERSION },
    scrapePieces: { some: { status: { not: 'withheld' } } },
    ...(after != null ? { id: { gt: after } } : {}),
  };
}

/** Tournaments the Tools tab says are waiting. */
export function countOldParser(): Promise<number> {
  return prisma.tournament.count({ where: oldParserWhere(null) });
}

/** The pages on record that a tournament can still be read from: everything not withheld. */
async function recordedPieces(id: bigint): Promise<PieceRef[]> {
  const rows = await prisma.scrapePiece.findMany({
    where: { tournamentId: id, status: { not: 'withheld' } },
    select: { kind: true, key: true },
  });
  return rows.map((r) => ({ kind: r.kind as PieceRef['kind'], key: r.key }));
}

/**
 * One press. `rescrape` is injectable for tests. `deadline` is an absolute
 * time (ms); the loop stops starting tournaments when little of it is left.
 */
export async function refreshOldParser(
  after: bigint | null,
  opts: { deadline?: number; rescrape?: typeof rescrapePieces } = {},
): Promise<OldParserResponse> {
  // Loaded when a press runs, not when the Tools tab renders: the ingest
  // code behind it is large and the tab only needs the count above.
  const rescrape = opts.rescrape ?? (await import('@/lib/calicotab/partialScrape')).rescrapePieces;
  const batch = await prisma.tournament.findMany({
    where: oldParserWhere(after),
    orderBy: { id: 'asc' },
    take: OLD_PARSER_BATCH_SIZE,
    select: { id: true },
  });
  if (batch.length === 0) return { refreshed: 0, failed: 0, left: 0, next: null };

  const out = { refreshed: 0, failed: 0 };
  const audited: bigint[] = [];
  let last = after ?? 0n;
  for (const { id } of batch) {
    if (opts.deadline != null && Date.now() >= opts.deadline - TAIL_MS) break;
    last = id;
    try {
      const r = await rescrape(id, await recordedPieces(id), { deadline: opts.deadline });
      if (r.failed.length > 0) {
        out.failed += 1;
      } else {
        // Guarded so a scrape that stamped it meanwhile is not rewound.
        await prisma.tournament.updateMany({
          where: { id, parserVersion: { lt: PARSER_VERSION } },
          data: { parserVersion: PARSER_VERSION },
        });
        out.refreshed += 1;
      }
      audited.push(id);
    } catch (err) {
      // A busy or unreachable tournament is a failure of this press, nothing
      // more; only the unexpected is reported, and by code, not by message.
      const name = (err as { name?: string }).name;
      if (name !== 'ScrapeBusyError' && name !== 'TournamentNotFoundError') {
        Sentry.captureException(err, { tags: { route: 'api/admin/old-parser', stage: 'refresh' } });
      }
      out.failed += 1;
    }
  }
  for (let i = 0; i < audited.length; i += AUDIT_CHUNK) {
    await runAudit(audited.slice(i, i + AUDIT_CHUNK));
  }
  const left = await prisma.tournament.count({ where: oldParserWhere(last) });
  return { ...out, left, next: left > 0 ? String(last) : null };
}
