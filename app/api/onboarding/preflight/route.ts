import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { prisma } from '@/lib/db';
import { fetchHtmlWithProvenance, LANDING_FETCH_TIMEOUT_MS } from '@/lib/calicotab/fetch';
import { FetchSession, isIngestDeadlineError } from '@/lib/calicotab/fetchSession';
import { parsePrivateUrlPage } from '@/lib/calicotab/parseNav';
import { nameSample, PREFLIGHT_SKIPPED } from '@/lib/identity/nameSample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 10;

/** Stop starting page fetches with this much of the 60 s function left. */
const FETCH_BUDGET_MS = 45_000;

/**
 * Onboarding preflight: read the user's private-URL pages, newest first, and
 * save the name each one shows on `DiscoveredUrl.registrationName`.
 *
 * This step only learns who the user is (owner, 2026-10-30): it reads until
 * the sample in lib/identity/nameSample.ts is complete (at least ten pages
 * and a majority name), then marks the links it did not need as skipped
 * (PREFLIGHT_SKIPPED). Tournaments are linked at the import step. The reads
 * share one session, so calicotab is paced as one host, and stop before the
 * function budget runs out; a link not reached stays pending for the next
 * call, which the onboarding screen makes until `remaining` is 0.
 *
 * Failure handling: on any error (HTTP non-2xx, network, parse miss) we
 * record the human-readable reason on `lastPreflightError` and set
 * `registrationName=''` so the next batch skips it. The UI can fetch errors
 * via /api/onboarding/errors or read them from the response of this call.
 *
 * Accepts ?retry=true on the request URL — when set, also re-processes URLs
 * that previously failed (registrationName='') so the user can recover from
 * a transient Cloudflare blip without manual SQL.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit('onboarding:preflight', session.user.id);
  if (limited) return limited;
  const userId = session.user.id;

  // Retry modes:
  //   ?retry=true     → full re-extract, clears every unclaimed URL (use
  //                     after a parser fix, when good names need refresh)
  //   ?retry=failures → only re-process URLs that previously failed (where
  //                     lastPreflightError is non-null). 99% of the time
  //                     this is what users want — re-fetching successfully-
  //                     parsed names just wastes Cloudflare budget.
  const retryParam = new URL(req.url).searchParams.get('retry');
  const retryMode: 'full' | 'failures' | null =
    retryParam === 'true' ? 'full' : retryParam === 'failures' ? 'failures' : null;

  if (retryMode === 'full') {
    await prisma.discoveredUrl.updateMany({
      where: { userId, registrationPersonId: null },
      data: { registrationName: null, lastPreflightError: null },
    });
  } else if (retryMode === 'failures') {
    await prisma.discoveredUrl.updateMany({
      where: {
        userId,
        registrationPersonId: null,
        lastPreflightError: { not: null },
        NOT: { lastPreflightError: PREFLIGHT_SKIPPED },
      },
      data: { registrationName: null, lastPreflightError: null },
    });
  }

  const before = nameSample(await namesRead(userId));
  const pending = before.complete
    ? []
    : await prisma.discoveredUrl.findMany({
        where: { userId, registrationName: null, registrationPersonId: null },
        orderBy: { messageDate: 'desc' },
        take: Math.min(BATCH_SIZE, before.need),
        select: { id: true, url: true },
      });

  type BatchError = { url: string; error: string };
  const errors: BatchError[] = [];
  let extracted = 0;
  let failed = 0;

  const fetchSession = new FetchSession({ deadline: Date.now() + FETCH_BUDGET_MS });

  await Promise.all(
    pending.map(async ({ id, url }) => {
      const outcome = await nameFromPage(url, fetchSession);
      // Out of this call's time: leave the URL pending for the next batch.
      if (outcome === null) return;
      if (outcome.error) {
        errors.push({ url, error: outcome.error });
        failed++;
      } else {
        extracted++;
      }
      await prisma.discoveredUrl.update({
        where: { id },
        data: { registrationName: outcome.name, lastPreflightError: outcome.error },
      });
    }),
  );

  // The name is settled: the links not read are not needed at this step.
  if (nameSample(await namesRead(userId)).complete) {
    await prisma.discoveredUrl.updateMany({
      where: { userId, registrationName: null, registrationPersonId: null },
      data: { registrationName: '', lastPreflightError: PREFLIGHT_SKIPPED },
    });
  }

  const remaining = await prisma.discoveredUrl.count({
    where: { userId, registrationName: null, registrationPersonId: null },
  });

  return NextResponse.json({
    extracted,
    failed,
    processed: pending.length,
    remaining,
    errors,
  });
}

type NameOutcome = { name: string; error: string | null };

/** Names already read off this user's private-URL pages. */
async function namesRead(userId: string): Promise<string[]> {
  const rows = await prisma.discoveredUrl.findMany({
    where: { userId, registrationName: { not: null } },
    select: { registrationName: true },
  });
  return rows.map((r) => r.registrationName ?? '');
}

/**
 * The registration name from the private-URL page itself. Null when this
 * call ran out of time before the page could be fetched.
 */
async function nameFromPage(url: string, session: FetchSession): Promise<NameOutcome | null> {
  try {
    const r = await fetchHtmlWithProvenance(url, { session, timeoutMs: LANDING_FETCH_TIMEOUT_MS });
    if (!r.ok) {
      // Status only. The fetched body never travels back to the caller — see
      // the note in lib/calicotab/ingest.ts's landing fetch.
      console.warn('[preflight] fetch failed', {
        status: r.status,
        bodyPreview: r.bodyPreview.replace(/\s+/g, ' ').slice(0, 300),
      });
      return { name: '', error: `HTTP ${r.status}` };
    }
    const name = (parsePrivateUrlPage(r.html, url).registration.personName ?? '').trim();
    return name
      ? { name, error: null }
      : { name: '', error: 'fetch ok (200) but no participant name found on the landing page' };
  } catch (e) {
    if (isIngestDeadlineError(e)) return null;
    return { name: '', error: e instanceof Error ? e.message : String(e) };
  }
}
