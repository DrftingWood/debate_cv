import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Fixed-window rate limiting, backed by Postgres.
 *
 * Why not an in-memory map: the app runs on serverless functions, where
 * each invocation can be a fresh process and concurrent invocations do not
 * share memory. A process-local counter would limit nothing in production
 * while looking like it worked in dev — the worst kind of security control.
 *
 * Why not Redis/Upstash: Postgres is already a hard dependency and this
 * costs one round trip on the routes that opt in. If limits ever need to be
 * per-second rather than per-hour, revisit.
 *
 * The increment is a single atomic upsert, so concurrent requests cannot
 * race past the limit by both reading a stale count: the CASE expression
 * resets the window and the counter in the same statement that increments
 * it.
 */

export type RateLimitRule = {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
};

/**
 * The limits, in one place so they can be read as a policy rather than
 * hunted for across routes. Tightest on anything that makes the server
 * perform an outbound fetch or build an expensive artifact.
 */
export const RATE_LIMITS = {
  // Each call triggers a full tournament scrape: ~16 outbound fetches, up
  // to 60s of function time, and `force: true` skips the cache entirely.
  'ingest:url': { limit: 20, windowSec: 3600 },
  // Gmail scan already has a 5-minute cooldown of its own; this bounds the
  // day rather than the minute.
  'ingest:gmail': { limit: 12, windowSec: 3600 },
  'ingest:drain': { limit: 30, windowSec: 3600 },
  // Fetches every pending URL's landing page.
  'onboarding:preflight': { limit: 10, windowSec: 3600 },
  // Builds a workbook in memory.
  'cv:export': { limit: 30, windowSec: 3600 },
  'account:export': { limit: 10, windowSec: 3600 },
  // Write endpoints — generous, since bulk claiming during onboarding is
  // normal and legitimate.
  'persons:claim': { limit: 200, windowSec: 3600 },
  'tags:propose': { limit: 120, windowSec: 3600 },
  'cv:errorReport': { limit: 20, windowSec: 3600 },
  'sharing:update': { limit: 60, windowSec: 3600 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the current window resets. */
  retryAfterSec: number;
  limit: number;
  remaining: number;
};

/**
 * Consume one unit from `name`'s bucket for `subject` (normally a user id).
 *
 * Fails OPEN: if the counter query itself errors, the request proceeds. A
 * rate limiter that takes the whole site down when its table is unavailable
 * has done more damage than the abuse it was meant to stop. The failure is
 * logged so it is visible rather than silent.
 */
export async function consumeRateLimit(
  name: RateLimitName,
  subject: string,
): Promise<RateLimitResult> {
  const { limit, windowSec } = RATE_LIMITS[name];
  const key = `${name}:${subject}`;

  try {
    const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "windowStart")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."windowStart" < NOW() - ${`${windowSec} seconds`}::interval
          THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimit"."windowStart" < NOW() - ${`${windowSec} seconds`}::interval
          THEN NOW()
          ELSE "RateLimit"."windowStart"
        END
      RETURNING "count", "windowStart"
    `;
    const row = rows[0];
    if (!row) return { ok: true, retryAfterSec: 0, limit, remaining: limit };

    const elapsedSec = Math.floor((Date.now() - new Date(row.windowStart).getTime()) / 1000);
    return {
      ok: row.count <= limit,
      retryAfterSec: Math.max(1, windowSec - elapsedSec),
      limit,
      remaining: Math.max(0, limit - row.count),
    };
  } catch (err) {
    console.error('[rateLimit] counter unavailable, allowing request', {
      name,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: true, retryAfterSec: 0, limit, remaining: limit };
  }
}

/**
 * Route helper: returns a 429 response when the caller is over budget, or
 * null to continue. Sets Retry-After and the conventional RateLimit-*
 * headers so clients can back off intelligently rather than hammering.
 *
 *   const limited = await enforceRateLimit('ingest:url', userId);
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  name: RateLimitName,
  subject: string,
): Promise<NextResponse | null> {
  const result = await consumeRateLimit(name, subject);
  if (result.ok) return null;
  return NextResponse.json(
    {
      error: 'rate_limited',
      reason: `Too many requests. Try again in ${Math.ceil(result.retryAfterSec / 60)} minute(s).`,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSec),
        'RateLimit-Limit': String(result.limit),
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': String(result.retryAfterSec),
      },
    },
  );
}

/**
 * Drop counters whose window closed long ago. Called from the daily cron
 * alongside the other retention pruning — without it the table accumulates
 * one row per (route, user) pair forever.
 */
export async function pruneRateLimits(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const res = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return res.count;
}
