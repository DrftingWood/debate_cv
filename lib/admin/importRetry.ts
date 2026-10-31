/**
 * Bulk retry of failed imports through POST /api/admin/jobs/retry, which
 * takes at most 200 job ids a request. "Retry all n" can name more than that
 * (every job behind every failing tournament), so the ids go in batches, one
 * request after another under the page's single flight.
 */
export const RETRY_BATCH_MAX = 200;

/** `ids` in batches the route accepts, each id once. */
export function retryBatches(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += RETRY_BATCH_MAX) {
    out.push(unique.slice(i, i + RETRY_BATCH_MAX));
  }
  return out;
}
