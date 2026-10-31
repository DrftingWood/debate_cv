import { prisma } from '@/lib/db';
import { IngestJobStatus, Prisma } from '@prisma/client';
import { throttleKey } from '@/lib/calicotab/fetchSession';
import { DELETED_MARKER } from '@/lib/admin/deletedTournaments';

export async function enqueueUrl(userId: string, url: string): Promise<void> {
  // `reingestLocked` is the user-controlled "don't touch this URL" flag —
  // written by `app/api/ingest/lock/route.ts` when a user clicks Lock on
  // the dashboard. Honoured here so a queued retry / drain / Re-ingest-mine
  // skips locked URLs without surfacing a confusing failure.
  const locked = await prisma.discoveredUrl.findUnique({
    where: { userId_url: { userId, url } },
    select: { reingestLocked: true },
  });
  if (locked?.reingestLocked) return;

  await prisma.ingestJob.updateMany({
    where: { userId, url, status: IngestJobStatus.failed },
    data: {
      status: IngestJobStatus.pending,
      attempts: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
      scheduledAt: new Date(),
    },
  });
  await prisma.ingestJob.upsert({
    where: { userId_url: { userId, url } },
    update: {},
    create: { userId, url, status: IngestJobStatus.pending },
  });
}

/**
 * Reclaim jobs that were marked 'running' but whose worker never finished
 * (killed mid-run, deploy cycled, time budget exceeded). Belt-and-suspenders
 * recovery that runs at the start of every drain + cron invocation.
 */
export async function resetStuckRunning(
  params: { userId?: string; olderThanMinutes?: number } = {},
) {
  // Multiply an int-cast parameter by a constant INTERVAL instead of calling
  // make_interval(). Prisma serializes JS numbers as BIGINT, which make_interval
  // rejects with "function make_interval(mins => bigint) does not exist".
  const minutes = Math.max(0, Math.floor(params.olderThanMinutes ?? 5));
  const threshold = Prisma.sql`(NOW() - (${minutes}::int * INTERVAL '1 minute'))`;
  /*
   * `scheduledAt = NOW()` sends the recovered job to the BACK of the queue.
   *
   * rescheduleJob already does this for jobs that fail gracefully (see the
   * note there on audit issue #9), but the platform-kill path landed here
   * instead and left scheduledAt at the original submit time. Since
   * claimOnePending orders by `scheduledAt ASC`, a job whose ingest runs
   * longer than the serverless function's remaining budget came straight
   * back to the head of the queue on the next tick, was claimed first
   * again, was killed again, and starved every other user's jobs behind it
   * — indefinitely, because the attempt-limit check lives in the catch
   * block and a killed function never reaches it.
   */
  if (params.userId) {
    // Raw SQL bypasses Prisma's @updatedAt — set it explicitly (see the
    // schema comment on IngestJob.updatedAt).
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'pending', "startedAt" = NULL,
          "scheduledAt" = NOW(), "updatedAt" = NOW()
      WHERE "userId" = ${params.userId}
        AND "status" = 'running'
        AND ("startedAt" IS NULL OR "startedAt" < ${threshold})
    `);
  } else {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'pending', "startedAt" = NULL,
          "scheduledAt" = NOW(), "updatedAt" = NOW()
      WHERE "status" = 'running'
        AND ("startedAt" IS NULL OR "startedAt" < ${threshold})
    `);
  }
}

/**
 * SQL expression extracting the host from a job's URL.
 *
 * Every Tabbycat tournament lives on its own subdomain
 * (`delhi2025.calicotab.com`, `wudc2024.calicotab.com`, …), so the host is
 * an exact proxy for "which upstream server does this job hammer". That is
 * what makes the drain safely concurrent: the fetch throttle in
 * lib/calicotab/fetchSession.ts is per-host, and two jobs on different
 * hosts share no rate budget at all.
 */
const RAW_HOST_SQL = Prisma.sql`lower(split_part(split_part("url", '//', 2), '/', 1))`;
/*
 * Every calicotab subdomain is served by one backend (2026-10-30: all of them
 * slowed to 10-40 s at once, calicotab.com included), so for politeness they
 * are one host. Matches jobHost below.
 */
const JOB_HOST_SQL = Prisma.sql`CASE WHEN ${RAW_HOST_SQL} = 'calicotab.com' OR ${RAW_HOST_SQL} LIKE '%.calicotab.com' THEN 'calicotab.com' ELSE ${RAW_HOST_SQL} END`;

/**
 * Atomically claim a single pending job. Returns null when queue is empty.
 *
 * `excludeHosts` keeps a concurrent drain to at most one in-flight job per
 * upstream host. FetchSession serializes requests WITHIN one ingest, which
 * is what stopped the Cloudflare burst-403s; running two ingests against
 * the same host at once would reintroduce exactly the bursts that fix
 * removed, because each ingest carries its own independent throttle chain.
 * Different hosts are unrelated, so those run in parallel freely.
 */
export async function claimOnePending(
  params: { userId?: string; excludeHosts?: string[] } = {},
): Promise<{ id: string; userId: string; url: string; attempts: number } | null> {
  const whereUser = params.userId ? Prisma.sql`AND "userId" = ${params.userId}` : Prisma.sql``;
  const busy = params.excludeHosts?.filter((h) => h.length > 0) ?? [];
  const whereHost = busy.length
    ? Prisma.sql`AND ${JOB_HOST_SQL} NOT IN (${Prisma.join(busy)})`
    : Prisma.sql``;
  const rows = await prisma.$queryRaw<
    Array<{ id: string; userId: string; url: string; attempts: number }>
  >(
    Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'running', "attempts" = "attempts" + 1, "startedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = (
        SELECT "id" FROM "IngestJob"
        WHERE "status" = 'pending' AND "scheduledAt" <= NOW() ${whereUser} ${whereHost}
        ORDER BY "scheduledAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id", "userId", "url", "attempts"
    `,
  );
  return rows[0] ?? null;
}

/** The host a job's fetches will target, or '' if the URL is unparseable. */
export function jobHost(url: string): string {
  try {
    // One key for every calicotab subdomain, as the fetch throttle uses.
    return throttleKey(new URL(url).host);
  } catch {
    return '';
  }
}

export async function markJobDone(id: string): Promise<void> {
  const updated = await prisma.ingestJob.update({
    where: { id },
    data: { status: IngestJobStatus.done, finishedAt: new Date(), lastError: null },
    select: { userId: true },
  });
  await notifyIfQueueSettled(updated.userId);
}

/** A "batch" for the CV-ready notice: jobs finished within this window count. */
const READY_BATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * When a job reaches a terminal state and it was the user's last
 * pending/running one, surface a "your CV is ready" bell notification — but
 * only if at least one tournament actually loaded recently (C106). A queue
 * that emptied because everything failed gets the failure notice instead,
 * never "ready". Best-effort + deduped, so back-to-back drains don't fire
 * twice.
 */
async function notifyIfQueueSettled(userId: string): Promise<void> {
  const remaining = await prisma.ingestJob.count({
    where: { userId, status: { in: [IngestJobStatus.pending, IngestJobStatus.running] } },
  });
  if (remaining !== 0) return;
  const loaded = await prisma.ingestJob.count({
    where: {
      userId,
      status: IngestJobStatus.done,
      finishedAt: { gte: new Date(Date.now() - READY_BATCH_WINDOW_MS) },
    },
  });
  if (loaded === 0) return;
  const { writeNotification } = await import('@/lib/notifications/write');
  await writeNotification({
    userId,
    kind: 'ingest_done',
    title: 'Your CV is ready',
    body: 'Your tournaments have been loaded.',
    href: '/cv',
    dedupeWithinMs: 60 * 1000,
  });
}

/**
 * Bell notice for a job that failed for good. Plain language: no error text,
 * which is for the dashboard and Sentry. Deduped over ten minutes so a batch
 * of failures is one bell entry. In-app only, by design.
 */
async function notifyJobFailed(userId: string): Promise<void> {
  const { writeNotification } = await import('@/lib/notifications/write');
  await writeNotification({
    userId,
    kind: 'ingest_failed',
    title: "We couldn't load a tournament",
    body: 'One of your tournament links could not be loaded. Open the dashboard to retry it.',
    href: '/dashboard',
    dedupeWithinMs: 10 * 60 * 1000,
  });
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  const updated = await prisma.ingestJob.update({
    where: { id },
    data: {
      status: IngestJobStatus.failed,
      finishedAt: new Date(),
      lastError: error.slice(0, 2000),
    },
    select: { userId: true },
  });
  await notifyJobFailed(updated.userId);
  await notifyIfQueueSettled(updated.userId);
}

/**
 * Classify an ingest error string as permanently unrecoverable. Currently
 * matches HTTP 404 on the landing page (dead Heroku apps, removed
 * Calicotab tournaments) — the dominant permanent-failure pattern in
 * production. Add new patterns here as we learn more terminal modes.
 *
 * Used by the drain + cron handlers to fast-fail to `abandoned` without
 * burning 3 retry attempts on a URL that will never recover.
 */
export function isPermanentError(error: string): boolean {
  // HTTP 404 on the landing fetch — the URL itself returned not-found.
  // We don't match arbitrary 404s in nested tab fetches because those
  // can be transient (Tabbycat sometimes 404s a /tab/ URL during a
  // reindex) and the user might want to retry.
  // A tab an admin deleted (deletedTournaments.ts): refused on purpose.
  if (error.startsWith(DELETED_MARKER)) return true;
  return /fetch landing\b[^]*HTTP 404\b/.test(error);
}

/**
 * Mark a job as terminally abandoned — permanently dead URL with no
 * recovery path. Distinct from `markJobFailed` so the dashboard can
 * surface the actionable-failed count separately and retry-failed
 * naturally skips these via the status enum rather than regex.
 */
export async function markJobAbandoned(id: string, error: string): Promise<void> {
  const updated = await prisma.ingestJob.update({
    where: { id },
    data: {
      status: IngestJobStatus.abandoned,
      finishedAt: new Date(),
      lastError: error.slice(0, 2000),
    },
    select: { userId: true },
  });
  await notifyJobFailed(updated.userId);
  await notifyIfQueueSettled(updated.userId);
}

/**
 * Put a job back WITHOUT spending an attempt, at its old place in the queue.
 *
 * For an ingest that stopped itself at its deadline having written nothing
 * (IngestDeadlineError): it did not fail, it ran out of the invocation it was
 * started late in. Unlike rescheduleJob, scheduledAt is left alone so the job
 * stays near the head and the next tick starts it first, with a full budget;
 * and the attempt its claim took is given back, so the attempt ceiling still
 * means "failed N times", not "was started late N times".
 */
export async function releaseJob(id: string, note: string): Promise<void> {
  await prisma.ingestJob.update({
    where: { id },
    data: {
      status: IngestJobStatus.pending,
      startedAt: null,
      attempts: { decrement: 1 },
      lastError: note.slice(0, 2000),
    },
  });
}

export async function rescheduleJob(id: string, error: string, delayMs = 0): Promise<void> {
  // Bump scheduledAt to NOW so the retry competes fairly against fresh user
  // submissions in claimOnePending's `ORDER BY scheduledAt ASC` queue.
  // Previously the field stayed at the original submit time, which meant a
  // backed-up failed job kept getting priority over newly-enqueued URLs and
  // a user's fresh upload could wait minutes behind a churning retry
  // (audit issue #9).
  await prisma.ingestJob.update({
    where: { id },
    data: {
      status: IngestJobStatus.pending,
      startedAt: null,
      // A delay holds the job back: claimOnePending skips future scheduledAt.
      scheduledAt: new Date(Date.now() + delayMs),
      lastError: error.slice(0, 2000),
    },
  });
}

/**
 * Wait before retrying a job whose private-URL page did not answer (timeout,
 * 5xx, rate limit): 15 minutes, then an hour. A slow spell at calicotab used
 * to spend all three attempts within half an hour (2026-10-30); spread out,
 * they span hours, long enough for a slow spell to pass.
 */
export function landingRetryDelayMs(attempts: number): number {
  return attempts <= 1 ? 15 * 60_000 : 60 * 60_000;
}

/** Did the private-URL page fail for a reason that may pass (not a refusal or a 404)? */
export function isTransientLandingError(error: string): boolean {
  return /fetch landing\b[^]*HTTP (0|408|425|429|5\d\d)\b/.test(error);
}
