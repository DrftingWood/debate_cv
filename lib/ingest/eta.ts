/**
 * Seconds until an ingest queue is empty, or null when it already is.
 *
 * The estimate used to be "queued jobs × the average successful job". That
 * average is mostly cache hits taking a second or two, and it leaves out
 * what actually sets the pace: slow and failed live scrapes, one calicotab
 * job at a time, and the gaps between drains (with no tab open the cron
 * runs every 15 minutes). On production on 2026-10-30 it said 7 minutes for
 * 145 jobs while the last hour had finished 66: about 2 hours.
 *
 * So the queue's own recent rate decides: jobs finished in the last hour
 * (done or failed) over the time since the first of them started. Too few
 * finishes to measure a rate falls back to the per-job time. Either way the
 * answer is never earlier than the latest retry already scheduled.
 */

/** Below this many recent finishes the rate is noise, not a measurement. */
const MIN_FINISHES_FOR_RATE = 5;

export function estimateQueueSeconds(q: {
  now: number;
  pending: number;
  running: number;
  /** Jobs that finished (done, failed or abandoned) within the batch window. */
  finishedRecent: number;
  /** When the first of those started; null when none did. */
  firstStartedAt: Date | null;
  /** Mean seconds of recent successful jobs, or the default. */
  perJobSeconds: number;
  /** How long the oldest running job has been running. */
  currentElapsedSeconds: number;
  /** The furthest-out scheduledAt among pending jobs (delayed retries). */
  latestScheduledAt: Date | null;
}): number | null {
  const active = q.pending + q.running;
  if (active === 0) return null;

  const spanSeconds = q.firstStartedAt ? (q.now - q.firstStartedAt.getTime()) / 1000 : 0;
  let eta: number;
  if (q.finishedRecent >= MIN_FINISHES_FOR_RATE && spanSeconds > 0) {
    eta = (active * spanSeconds) / q.finishedRecent;
  } else {
    eta = q.pending * q.perJobSeconds;
    // Credit the in-flight jobs for the time they have already spent.
    if (q.running > 0) eta += Math.max(q.perJobSeconds - q.currentElapsedSeconds, 5) * q.running;
  }

  const untilLastRetry = q.latestScheduledAt ? (q.latestScheduledAt.getTime() - q.now) / 1000 : 0;
  return Math.max(Math.round(Math.max(eta, untilLastRetry)), 5);
}
