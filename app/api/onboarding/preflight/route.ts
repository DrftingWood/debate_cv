import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchHtmlWithProvenance } from '@/lib/calicotab/fetch';
import { parsePrivateUrlPage } from '@/lib/calicotab/parseNav';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 10;

/**
 * Onboarding preflight: for each of the user's DiscoveredUrls that hasn't
 * yet had its registration name extracted, fetch the landing page and parse
 * out the participant name. Saves the name on `DiscoveredUrl.registrationName`.
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
  const userId = session.user.id;

  const retry = new URL(req.url).searchParams.get('retry') === 'true';

  if (retry) {
    // Reset the failure markers so this batch picks them up again.
    await prisma.discoveredUrl.updateMany({
      where: { userId, registrationName: '', registrationPersonId: null },
      data: { registrationName: null, lastPreflightError: null },
    });
  }

  const pending = await prisma.discoveredUrl.findMany({
    where: { userId, registrationName: null, registrationPersonId: null },
    orderBy: { messageDate: 'desc' },
    take: BATCH_SIZE,
    select: { id: true, url: true },
  });

  type BatchError = { url: string; error: string };
  const errors: BatchError[] = [];
  let extracted = 0;
  let failed = 0;

  await Promise.all(
    pending.map(async ({ id, url }) => {
      let name = '';
      let errMsg: string | null = null;
      try {
        const r = await fetchHtmlWithProvenance(url);
        if (!r.ok) {
          const preview = r.bodyPreview.replace(/\s+/g, ' ').slice(0, 200);
          errMsg = `HTTP ${r.status}${preview ? ` — ${preview}` : ''}`;
        } else {
          const snap = parsePrivateUrlPage(r.html, url);
          name = (snap.registration.personName ?? '').trim();
          if (!name) {
            errMsg =
              'fetch ok (200) but no participant name found on the landing page';
          }
        }
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
      }

      if (errMsg) {
        errors.push({ url, error: errMsg });
        failed++;
      } else {
        extracted++;
      }

      await prisma.discoveredUrl.update({
        where: { id },
        data: {
          registrationName: name || '',
          lastPreflightError: errMsg ?? null,
        },
      });
    }),
  );

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
