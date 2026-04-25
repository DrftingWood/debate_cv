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

  for (const { url } of urls) {
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
  }

  return NextResponse.json({ queued: urls.length });
}
