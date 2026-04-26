import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { IngestJobStatus } from '@prisma/client';
import { privateUrlVariants } from '@/lib/gmail/extract';

export const runtime = 'nodejs';

const Body = z.object({
  url: z.string().url(),
});

/**
 * Reset a failed or stuck ingestion back to a clean pending state.
 * Clears the IngestJob error + attempts and strips ingestedAt / tournamentId
 * from the DiscoveredUrl so the dashboard shows the URL as unprocessed.
 * The Tournament row is intentionally kept — it may be shared with other
 * users and will be overwritten on re-ingest via upsert.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: 'bad_request', details: parse.error.flatten() }, { status: 400 });
  }
  const { url } = parse.data;
  const urlVariants = privateUrlVariants(url);

  await prisma.$transaction([
    prisma.ingestJob.updateMany({
      where: { userId, url: { in: urlVariants } },
      data: {
        status: IngestJobStatus.pending,
        attempts: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
      },
    }),
    prisma.discoveredUrl.updateMany({
      where: { userId, url: { in: urlVariants } },
      data: {
        ingestedAt: null,
        tournamentId: null,
        registrationPersonId: null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
