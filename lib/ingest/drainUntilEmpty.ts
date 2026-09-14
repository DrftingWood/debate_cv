import { postJson, type ApiResult } from '@/lib/utils/api';

export type DrainResponse = { processed: number; remaining: number };
export type DrainProgress = { processed: number; remaining: number };
/**
 * `failed` records that at least one drain call errored during the batch.
 *
 * It is not derivable from `remaining`: a 504 leaves the timed-out job in
 * 'running', resetStuckRunning won't reclaim it for ~5 minutes, and the
 * drain route counts only 'pending' — so the next call legitimately
 * answers {processed: 0, remaining: 0} while a tournament is still stuck.
 * Without this flag that batch reported an unqualified success.
 */
export type DrainSummary = DrainProgress & { failed: boolean };

export type DrainDeps = {
  signal?: AbortSignal;
  /** Injected for tests; defaults to a real POST to /api/ingest/drain. */
  post?: () => Promise<ApiResult<DrainResponse>>;
  /** Injected for tests so backoffs don't cost real wall-clock time. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Only 5xx and network errors are worth a retry.
 *
 * postJson flattens every non-2xx into ok:false, so without this gate an
 * expired session (401), a deterministic 500-class bug, or an offline
 * browser each cost three round trips and two 5s sleeps before the real
 * error surfaced. `status: 0` is postJson's marker for a fetch that threw.
 */
function isTransientFailure(status: number): boolean {
  return status === 0 || status >= 500;
}

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_BACKOFF_MS = 5_000;
const BETWEEN_CALLS_MS = 2_000;

export async function drainUntilEmpty(
  onProgress: (summary: DrainProgress) => void,
  deps: DrainDeps = {},
): Promise<DrainSummary> {
  const post = deps.post ?? (() => postJson<DrainResponse>('/api/ingest/drain'));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const signal = deps.signal;

  let totalProcessed = 0;
  let remaining = 0;
  let consecutiveFailures = 0;
  let failed = false;

  for (let i = 0; i < 50; i++) {
    if (signal?.aborted) break;
    const result = await post();
    if (!result.ok) {
      failed = true;
      // Retrying a permanent failure only delays the error the user needs
      // to see, so surface it immediately.
      if (!isTransientFailure(result.status)) {
        throw new Error(result.error);
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(result.error);
      }
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    consecutiveFailures = 0;
    totalProcessed += result.data.processed ?? 0;
    remaining = result.data.remaining ?? 0;
    onProgress({ processed: totalProcessed, remaining });
    if ((result.data.processed ?? 0) === 0 || remaining === 0) break;
    if (remaining > 0) await sleep(BETWEEN_CALLS_MS);
  }
  return { processed: totalProcessed, remaining, failed };
}

export type DrainToast = { kind: 'success' | 'error' | 'info'; title: string; description: string };

export function summariseDrain(summary: DrainSummary, aborted: boolean): DrainToast {
  // An explicit Stop wins: the user chose to end the batch, so a drain
  // error along the way isn't the headline.
  if (aborted) {
    return {
      kind: 'info',
      title: 'Stopped',
      description: summary.remaining
        ? `Ingested ${summary.processed} · ${summary.remaining} queued for later.`
        : `Ingested ${summary.processed} private URLs.`,
    };
  }
  if (summary.failed) {
    const queued = summary.remaining
      ? `${summary.remaining} still queued. `
      : '';
    return {
      kind: 'info',
      title: 'Ingest incomplete',
      description:
        `Ingested ${summary.processed}, but some drains failed. ${queued}` +
        'Click "Ingest all" to retry — anything still stuck is picked up by the nightly run.',
    };
  }
  return {
    kind: 'success',
    title: 'Done',
    description: summary.remaining
      ? `Ingested ${summary.processed} · ${summary.remaining} queued for later.`
      : `Ingested ${summary.processed} private URLs.`,
  };
}
