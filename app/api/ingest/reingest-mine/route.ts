import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const urls = await prisma.discoveredUrl.findMany({
    where: { userId },
    select: { url: true },
  });

  // Skip URLs whose previous run hit a permanent HTTP 404 — the source page is
  // gone (Heroku app shut down, tournament unpublished, token rotated). No
  // amount of retrying recovers them; re-queueing just wastes drain time.
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
  for (const { url } of urls) {
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

  return NextResponse.json({ queued, skipped: dead.size });
}
