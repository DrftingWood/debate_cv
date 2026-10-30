import { prisma } from '@/lib/db';

// A scrape is recorded as pieces (one per tab, per break category, per
// results round) so a single flaky page can be retried and re-scraped alone
// instead of failing or redoing the whole tournament.

export type PieceKind = 'team' | 'speaker' | 'participants' | 'motions' | 'break' | 'round';

export type PieceRef = { kind: PieceKind; key: string };

export type PieceOutcome = PieceRef & {
  label: string;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
};

/**
 * Identity of a piece within its tournament. Single tabs need no key; a break
 * is told apart by its category slug and a round by its number. A round URL
 * with no number (unusual installs) falls back to its path so it still gets a
 * stable, unique key.
 */
export function pieceRefForUrl(kind: PieceKind, url: string): PieceRef {
  if (kind !== 'break' && kind !== 'round') return { kind, key: '' };
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL: treat the input as the path itself.
  }
  if (kind === 'break') {
    const last = path.split('/').filter(Boolean).pop() ?? '';
    return { kind, key: last.toLowerCase() };
  }
  const n = /\/results\/round\/(\d+)(?:\/|$)/.exec(path)?.[1];
  return { kind, key: n ?? path };
}

/** "R3" for a numbered prelim; outrounds keep their own name ("Grand Final"). */
export function roundPieceLabel(roundNumber: number | null, roundLabel: string | null): string {
  if (roundNumber != null && roundLabel != null && /^round\s+\d+$/i.test(roundLabel.trim())) {
    return `R${roundNumber}`;
  }
  return roundLabel ?? (roundNumber != null ? `R${roundNumber}` : '');
}

const RETRY_DELAYS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

/** Wait before the next try after the nth consecutive failure; null = stop retrying. */
export function retryDelayMs(failures: number): number | null {
  return RETRY_DELAYS_MS[failures - 1] ?? null;
}

/**
 * Upserts one row per outcome. A failure must not forget the last good load,
 * so `loadedAt` is only written on success. The new attempt count is only
 * known after the increment, so the retry time is set in a second write.
 */
export async function recordPieceOutcomes(
  tournamentId: bigint,
  outcomes: PieceOutcome[],
  now: Date = new Date(),
): Promise<void> {
  for (const o of outcomes) {
    const where = { tournamentId_kind_key: { tournamentId, kind: o.kind, key: o.key } };
    const base = { label: o.label, url: o.url, lastAttemptAt: now };
    if (o.ok) {
      const ok = { ...base, status: 'ok', attempts: 0, loadedAt: now, nextRetryAt: null };
      await prisma.scrapePiece.upsert({
        where,
        create: {
          tournamentId,
          kind: o.kind,
          key: o.key,
          httpStatus: o.httpStatus,
          lastError: null,
          ...ok,
        },
        update: { ...ok, httpStatus: o.httpStatus, lastError: null },
      });
      continue;
    }
    const failed = { ...base, status: 'failed', httpStatus: o.httpStatus, lastError: o.error };
    const row = await prisma.scrapePiece.upsert({
      where,
      create: { tournamentId, kind: o.kind, key: o.key, ...failed, attempts: 1 },
      update: { ...failed, attempts: { increment: 1 } },
    });
    const delay = retryDelayMs(row.attempts);
    await prisma.scrapePiece.update({
      where: { id: row.id },
      data: { nextRetryAt: delay == null ? null : new Date(now.getTime() + delay) },
    });
  }
}
