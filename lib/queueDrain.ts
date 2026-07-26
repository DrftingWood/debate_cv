import {
  claimOnePending,
  isPermanentError,
  jobHost,
  markJobAbandoned,
  markJobDone,
  markJobFailed,
  rescheduleJob,
} from '@/lib/queue';

export type DrainJob = { id: string; userId: string; url: string; attempts: number };
export type DrainOutcome = 'done' | 'failed' | 'abandoned' | 'retry';
export type DrainResult = { id: string; status: DrainOutcome; error?: string };

export type DrainReport = {
  processed: number;
  results: DrainResult[];
  /** True when the tick ended with time exhausted rather than an empty queue. */
  stoppedForBudget: boolean;
  /** Peak number of jobs actually in flight at once — the realised concurrency. */
  peakInFlight: number;
  /** Wall-clock milliseconds spent draining. */
  elapsedMs: number;
};

export type DrainDeps = {
  ingest: (url: string, userId: string) => Promise<unknown>;
  isDeadlockError: (err: unknown) => boolean;
  onTerminal?: (
    stage: 'ingest-abandoned' | 'ingest-failed-final' | 'ingest-budget-exhausted',
    err: unknown,
    job: DrainJob,
  ) => void;
  now?: () => number;
};

export type DrainOptions = {
  budgetMs: number;
  /** Do not START a job with less than this left — see the note in the route. */
  headroomMs: number;
  maxAttempts: number;
  /** Upper bound on simultaneous in-flight ingests. */
  concurrency: number;
};

/**
 * The queue drain, as a pure-ish scheduler over injected dependencies.
 *
 * ── Why this is concurrent, and why it is concurrent *by host* ────────────
 *
 * A single ingest is dominated by deliberate waiting, not work. Every
 * request to a tournament host goes through a per-host minimum interval
 * (lib/calicotab/fetchSession.ts) that exists because Cloudflare-fronted
 * Tabbycat instances return 403 for bursts. A typical tournament needs ~16
 * same-host fetches, so at the 1500ms floor roughly 24 seconds of each job
 * is the process sitting still, holding no CPU and no connection.
 *
 * Draining serially meant the whole queue paid that wait end to end: one
 * job per invocation, and with a daily platform cron plus a best-effort
 * 15-minute external trigger, a backlog cleared at a job per tick.
 *
 * The throttle, though, is per HOST — and Tabbycat gives every tournament
 * its own subdomain, so distinct jobs are almost always distinct hosts with
 * no shared rate budget. Running them together is free. What is NOT free is
 * two ingests of the SAME host at once: each carries its own throttle chain,
 * so they would race and reproduce exactly the bursts the serialization was
 * introduced to stop. `claimOnePending({ excludeHosts })` enforces at most
 * one in-flight job per host, which keeps the politeness guarantee exactly
 * as strong as it was while letting throughput scale with the number of
 * distinct hosts waiting.
 *
 * Workers claim lazily rather than being handed a pre-claimed batch: a
 * claim increments `attempts`, so claiming work we might not reach would
 * burn retries on jobs that never ran.
 */
export async function drainQueue(
  deps: DrainDeps,
  opts: DrainOptions,
): Promise<DrainReport> {
  const now = deps.now ?? Date.now;
  const started = now();
  const results: DrainResult[] = [];
  const inFlightHosts = new Set<string>();
  let stoppedForBudget = false;
  let inFlight = 0;
  let peakInFlight = 0;

  const budgetLeft = () => opts.budgetMs - (now() - started);

  const runOne = async (job: DrainJob): Promise<void> => {
    /*
     * A job can only arrive above the attempt ceiling by having been claimed
     * and then killed mid-ingest — every graceful failure path terminates at
     * maxAttempts below. Left alone it retries forever at the head of the
     * queue. Fail it here, before spending another invocation on it: a job
     * that consistently outlives the function budget needs a human, not
     * another attempt.
     */
    if (job.attempts > opts.maxAttempts) {
      const msg = `Exceeded ${opts.maxAttempts} attempts without completing — the ingest does not fit in the function time budget.`;
      deps.onTerminal?.('ingest-budget-exhausted', new Error(msg), job);
      await markJobFailed(job.id, msg);
      results.push({ id: job.id, status: 'failed', error: msg });
      return;
    }

    try {
      await deps.ingest(job.url, job.userId);
      await markJobDone(job.id);
      results.push({ id: job.id, status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (deps.isDeadlockError(err)) {
        // Deadlock-class failures are transient by definition (postgres
        // aborts the loser of a write race) — always reschedule, never
        // hard-fail, even past maxAttempts. See audit issue #8.
        await rescheduleJob(job.id, msg);
        results.push({ id: job.id, status: 'retry', error: msg });
      } else if (isPermanentError(msg)) {
        // Fast-fail to terminal `abandoned` on first attempt — the landing
        // page returned 404 (dead Heroku app, removed tournament). No
        // recovery path exists, so skip the remaining retries.
        deps.onTerminal?.('ingest-abandoned', err, job);
        await markJobAbandoned(job.id, msg);
        results.push({ id: job.id, status: 'abandoned', error: msg });
      } else if (job.attempts >= opts.maxAttempts) {
        // Only report on the FINAL attempt — earlier ones are expected to
        // flake (Cloudflare, slow hosts) and would noise up Sentry.
        deps.onTerminal?.('ingest-failed-final', err, job);
        await markJobFailed(job.id, msg);
        results.push({ id: job.id, status: 'failed', error: msg });
      } else {
        await rescheduleJob(job.id, msg);
        results.push({ id: job.id, status: 'retry', error: msg });
      }
    }
  };

  // Each worker claims-and-runs until the queue is empty or the budget is
  // too thin to start another job. `queueEmpty` latches so that once ANY
  // worker sees an empty queue the rest stop asking — with host exclusion a
  // claim can also return null simply because every remaining job belongs
  // to a busy host, so workers re-check rather than exiting on that.
  let queueDrained = false;

  /*
   * Claiming is serialized; ingesting is not.
   *
   * The host is only knowable AFTER the claim returns, so workers that
   * claim simultaneously all pass the same (stale) `excludeHosts` and can
   * each come back holding a job for the same host — which is precisely the
   * same-host concurrency this is meant to prevent. Taking a claim under a
   * mutex, and registering the host before releasing it, closes that
   * window. The cost is negligible: a claim is one indexed UPDATE, while
   * the ingest it guards runs for tens of seconds outside the lock.
   */
  let claimLock: Promise<unknown> = Promise.resolve();
  const claimNext = (): Promise<DrainJob | null> => {
    const next = claimLock.then(async () => {
      if (queueDrained) return null;
      const job = await claimOnePending({ excludeHosts: [...inFlightHosts] });
      if (job) {
        inFlightHosts.add(jobHost(job.url));
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
      }
      return job;
    });
    claimLock = next.catch(() => {});
    return next;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (queueDrained) return;
      if (budgetLeft() <= opts.headroomMs) {
        // Only a budget stop if there was still work to reach; a drained
        // queue exits above and must not be reported as truncated.
        stoppedForBudget = true;
        return;
      }

      const job = await claimNext();
      if (!job) {
        // Nothing claimable. If no other worker is busy, the queue is
        // genuinely empty; otherwise the remaining jobs are on hosts that
        // are in flight, so wait for a slot to free rather than spinning.
        if (inFlight === 0) {
          queueDrained = true;
          return;
        }
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }

      // Host + in-flight accounting already happened inside claimNext, so
      // that a concurrent claimer sees this host as busy.
      try {
        await runOne(job);
      } finally {
        inFlight -= 1;
        inFlightHosts.delete(jobHost(job.url));
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, () => worker());
  await Promise.all(workers);

  return {
    processed: results.length,
    results,
    stoppedForBudget,
    peakInFlight,
    elapsedMs: now() - started,
  };
}
