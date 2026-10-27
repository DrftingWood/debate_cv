/**
 * Background Gmail scanning, run by the cron tick (app/api/cron/process-queue).
 *
 * Each tick picks the users whose last scan is oldest, at most `maxUsers` of
 * those older than `intervalMs`, and scans them one after another until the
 * tick's scan budget is spent. A user is therefore scanned about every
 * `intervalMs`, new tournaments appear without a click, and the queue drain
 * that follows keeps most of the tick's time.
 *
 * Failure of one user never stops the others. A revoked or expired Google grant
 * is expected (the user removed access): it is cleared quietly so the dashboard
 * shows "reconnect Gmail", and it is not reported as an error.
 *
 * The decisions live here with their collaborators passed in, so they can be
 * tested without a database or Gmail.
 */

export type BackgroundScanDeps = {
  /** Users with a Gmail token, oldest scan first, scanned before `olderThan`. */
  findDue: (olderThan: Date, limit: number) => Promise<string[]>;
  scan: (userId: string) => Promise<{ total: number }>;
  /** True when this error means the Google grant is gone. */
  isGrantGone: (err: unknown) => boolean;
  /** Clear the stored token of a user whose grant is gone. */
  forgetGrant: (userId: string) => Promise<void>;
  /**
   * Stamp the user as just attempted after a failure, so a mailbox that keeps
   * failing waits one interval instead of being retried (and starving everyone
   * else) every minute.
   */
  markAttempted: (userId: string) => Promise<void>;
  /** Anything else that went wrong, for Sentry. */
  onError: (err: unknown, userId: string) => void;
  now?: () => number;
};

export type BackgroundScanOptions = {
  intervalMs: number;
  maxUsers: number;
  budgetMs: number;
};

export type BackgroundScanReport = {
  scanned: number;
  urlsFound: number;
  grantsCleared: number;
  failed: number;
  stoppedForBudget: boolean;
};

export async function scanDueMailboxes(
  deps: BackgroundScanDeps,
  opts: BackgroundScanOptions,
): Promise<BackgroundScanReport> {
  const now = deps.now ?? Date.now;
  const started = now();
  const report: BackgroundScanReport = {
    scanned: 0,
    urlsFound: 0,
    grantsCleared: 0,
    failed: 0,
    stoppedForBudget: false,
  };

  const due = await deps.findDue(new Date(started - opts.intervalMs), opts.maxUsers);
  for (const userId of due) {
    // Do not start a scan we expect to be cut off: leave the user for the next tick.
    if (now() - started >= opts.budgetMs) {
      report.stoppedForBudget = true;
      break;
    }
    try {
      const result = await deps.scan(userId);
      report.scanned += 1;
      report.urlsFound += result.total;
    } catch (err) {
      if (deps.isGrantGone(err)) {
        try {
          await deps.forgetGrant(userId);
        } catch {
          /* the grant is already invalid upstream; the local row is best effort */
        }
        report.grantsCleared += 1;
      } else {
        report.failed += 1;
        deps.onError(err, userId);
        try {
          await deps.markAttempted(userId);
        } catch {
          /* best effort: worst case the user is retried next tick */
        }
      }
    }
  }
  return report;
}
