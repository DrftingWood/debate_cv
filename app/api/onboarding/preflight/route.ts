import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchHtmlWithProvenance } from '@/lib/calicotab/fetch';
import { parsePrivateUrlPage } from '@/lib/calicotab/parseNav';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Process a small batch per call so the page can show incremental progress
// and so each invocation stays well under the Vercel function timeout for
// users with large inboxes.
const BATCH_SIZE = 10;

/**
 * Onboarding preflight: for each of the user's DiscoveredUrls that hasn't
 * yet had its registration name extracted, fetch the landing page and parse
 * out the participant name. Saves the name on `DiscoveredUrl.registrationName`.
 *
 * No Person rows are created here — that's deferred until the user picks
 * which names are theirs in the confirm step. A failed fetch leaves
 * registrationName NULL; the next preflight call will retry it (the page
 * decides when to stop polling based on the `remaining` counter).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const pending = await prisma.discoveredUrl.findMany({
    where: { userId, registrationName: null, registrationPersonId: null },
    orderBy: { messageDate: 'desc' },
    take: BATCH_SIZE,
    select: { id: true, url: true },
  });

  let extracted = 0;
  let failed = 0;
  await Promise.all(
    pending.map(async ({ id, url }) => {
      try {
        const r = await fetchHtmlWithProvenance(url);
        if (!r.ok) {
          failed++;
          // Mark with empty string so we don't re-fetch every batch — if the
          // landing is permanently unreachable (404 / dead Heroku), the name
          // is unknowable and there's nothing to ask the user about.
          await prisma.discoveredUrl.update({
            where: { id },
            data: { registrationName: '' },
          });
          return;
        }
        const snap = parsePrivateUrlPage(r.html, url);
        const name = (snap.registration.personName ?? '').trim();
        await prisma.discoveredUrl.update({
          where: { id },
          data: { registrationName: name || '' },
        });
        if (name) extracted++;
        else failed++;
      } catch {
        failed++;
        await prisma.discoveredUrl.update({
          where: { id },
          data: { registrationName: '' },
        });
      }
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
  });
}
