/**
 * Pure helpers behind the Imports page (/dashboard).
 *
 * The page used to `take: 200` on URLs and jobs and compute its tile counts
 * from those rows, so a heavy user saw "200" and lost older rows with no
 * notice (NV-12). It now loads a light row per URL (no tournament join),
 * derives every status and count from the full set, and only joins the
 * heavy tournament data for the one page of rows it renders.
 */

export type ImportStatus =
  | 'pending'
  | 'running'
  | 'failed'
  | 'unavailable'
  | 'done'
  | 'unmatched';

export type ImportFilterKey = 'all' | 'pending' | 'failed' | 'unmatched' | 'unavailable' | 'done';

export const IMPORT_PAGE_SIZE = 50;

export function statusFor(
  ingested: boolean,
  jobStatus: string | undefined,
  lastError: string | null | undefined,
): ImportStatus {
  // `abandoned` is the canonical terminal status for permanently-dead URLs
  // (HTTP 404 on landing). We also keep the legacy `lastError` check for
  // any rows that slipped through before the migration ran.
  if (jobStatus === 'abandoned') return 'unavailable';
  if (lastError && /HTTP 404/.test(lastError)) return 'unavailable';
  if (ingested) return 'done';
  if (jobStatus === 'running') return 'running';
  if (jobStatus === 'failed') return 'failed';
  return 'pending';
}

export function matchesFilter(status: ImportStatus, filter: ImportFilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'pending') return status === 'pending' || status === 'running';
  return status === filter;
}

export function countByFilter(
  statuses: readonly ImportStatus[],
): Record<ImportFilterKey, number> {
  const counts: Record<ImportFilterKey, number> = {
    all: statuses.length,
    pending: 0,
    failed: 0,
    unmatched: 0,
    unavailable: 0,
    done: 0,
  };
  for (const s of statuses) {
    if (s === 'pending' || s === 'running') counts.pending += 1;
    else counts[s] += 1;
  }
  return counts;
}

/**
 * The caption under the Failed tile on the Imports page.
 *
 * Two different things used to be mixed here. "Failed" counts links whose
 * import hit an error that may be temporary; those can be retried. "Dead"
 * links (the site answers 404) are a separate bucket (the Unavailable
 * filter): they are never retried, so they are not part of the Failed number.
 * A tile that read "0" over "34 dead links" looked self-contradictory. The
 * caption now says plainly what the number means and what the dead count is.
 */
export function failedTileHint(failed: number, dead: number): string {
  const deadText = `${dead} ${dead === 1 ? 'link no longer loads' : 'links no longer load'} (dead, not retried)`;
  if (failed > 0) return dead > 0 ? `open Failed to retry. ${deadText}` : 'open Failed to retry';
  return dead > 0 ? `Nothing to retry. ${deadText}` : 'nothing to retry';
}

/** 1-based page from a raw `?page=` value; junk and out-of-range clamp. */
export function resolvePage(raw: string | undefined, total: number, pageSize = IMPORT_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const n = Number.parseInt(raw ?? '', 10);
  const page = Number.isFinite(n) && n >= 1 ? Math.min(n, pages) : 1;
  const start = (page - 1) * pageSize;
  return { page, pages, start, end: Math.min(start + pageSize, total) };
}
