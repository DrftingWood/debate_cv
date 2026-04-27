import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  urls: z.array(z.string().url()).optional(),
});

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
  const selectedUrls = parse.data.urls?.length ? [...new Set(parse.data.urls)] : null;

  const urls = await prisma.discoveredUrl.findMany({
    where: {
      userId,
      ...(selectedUrls ? { url: { in: selectedUrls } } : {}),
    },
    select: { url: true, reingestLocked: true },
  });

  // Skip URLs whose previous run hit a permanent HTTP 404. The source page is
  // gone (Heroku app shut down, tournament unpublished, token rotated), so no
  // amount of retrying recovers them.
  const existingJobs = await prisma.ingestJob.findMany({
    where: { userId, url: { in: urls.map((u) => u.url) } },
    select: { url: true, lastError: true },
  });
  const dead = new Set(
    existingJobs
      .filter((j) => j.lastError && /HTTP 404/.test(j.lastError))
      .map((j) => j.url),
  );

  let queued = 0;
  let skippedLocked = 0;
  for (const { url, reingestLocked } of urls) {
    if (reingestLocked) {
      skippedLocked++;
      continue;
    }
    if (dead.has(url)) continue;
    await prisma.ingestJob.upsert({
      where: { userId_url: { userId, url } },
      update: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
        scheduledAt: new Date(),
      },
      create: { userId, url, status: 'pending' },
    });
    queued++;
  }

  return NextResponse.json({ queued, skipped: dead.size, skippedLocked });
}
