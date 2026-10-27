import { prisma } from '@/lib/db';
import { formatWait } from '@/lib/rateLimit';

/**
 * The once-a-day limit on the whole-mailbox Gmail scan.
 *
 * Enforced on the server (app/api/ingest/gmail/full). It lives in the existing
 * RateLimit table, one row per user under FULL_SCAN_PREFIX, so it needs no
 * schema change. `windowStart` is the moment the last full scan was started;
 * the next one is allowed 24 hours after it. Refused attempts do not touch the
 * row, so hammering the button never pushes the time back: the window is
 * rolling, measured from the last allowed scan.
 *
 * It does not use consumeRateLimit (lib/rateLimit.ts) because that counts
 * against the database clock and fails open. Here the clock is passed in (so a
 * test can move it) and a database error is an error: this limit protects the
 * Gmail quota, so it must not quietly allow a scan it could not record.
 */
export const FULL_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;
const FULL_SCAN_PREFIX = 'ingest:gmail:full:';

const keyFor = (userId: string) => `${FULL_SCAN_PREFIX}${userId}`;

export type FullScanGate =
  { allowed: true } | { allowed: false; availableAt: Date; retryAfterSec: number };

const blocked = (since: Date, now: number): FullScanGate => {
  const availableAt = new Date(since.getTime() + FULL_SCAN_WINDOW_MS);
  return {
    allowed: false,
    availableAt,
    retryAfterSec: Math.max(1, Math.ceil((availableAt.getTime() - now) / 1000)),
  };
};

/** When the next full scan is allowed; null when one is allowed now. Read-only. */
export async function fullScanAvailableAt(userId: string, now = Date.now()): Promise<Date | null> {
  const row = await prisma.rateLimit.findUnique({
    where: { key: keyFor(userId) },
    select: { windowStart: true },
  });
  if (!row || now - row.windowStart.getTime() >= FULL_SCAN_WINDOW_MS) return null;
  return new Date(row.windowStart.getTime() + FULL_SCAN_WINDOW_MS);
}

/**
 * Take the day's one full scan. Atomic: a first-ever claim is a row insert
 * (the key is the primary key) and a renewal is a compare-and-set on the old
 * `windowStart`, so two simultaneous requests cannot both win.
 */
export async function claimFullScan(userId: string, now = Date.now()): Promise<FullScanGate> {
  const key = keyFor(userId);
  const row = await prisma.rateLimit.findUnique({ where: { key }, select: { windowStart: true } });
  if (row && now - row.windowStart.getTime() < FULL_SCAN_WINDOW_MS) {
    return blocked(row.windowStart, now);
  }

  const stamp = new Date(now);
  if (!row) {
    try {
      await prisma.rateLimit.create({ data: { key, count: 1, windowStart: stamp } });
    } catch {
      // Lost the race to a concurrent first claim (unique key).
      return blocked(stamp, now);
    }
    return { allowed: true };
  }
  const res = await prisma.rateLimit.updateMany({
    where: { key, windowStart: row.windowStart },
    data: { windowStart: stamp, count: 1 },
  });
  if (res.count === 0) return blocked(stamp, now);
  return { allowed: true };
}

/**
 * Give the day's scan back when it failed before reading any mail (a revoked
 * grant, a Gmail outage), so a failure does not cost the user their one scan.
 */
export async function releaseFullScan(userId: string): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key: keyFor(userId) } });
}

/** The plain sentence for a refused full scan (the UI also shows the local time). */
export function fullScanBlockedReason(retryAfterSec: number): string {
  return `The whole-mailbox scan is limited to once every 24 hours. Try again in ${formatWait(retryAfterSec)}.`;
}
