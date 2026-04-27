import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const [urls, skippedLocked] = await Promise.all([
    prisma.discoveredUrl.findMany({
      where: { reingestLocked: false },
      select: { userId: true, url: true },
    }),
    prisma.discoveredUrl.count({ where: { reingestLocked: true } }),
  ]);

  for (const { userId, url } of urls) {
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

  return NextResponse.json({ queued: urls.length, skippedLocked });
}
