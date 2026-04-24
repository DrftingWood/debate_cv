import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const jobs = await prisma.ingestJob.findMany({
    where: { userId: session.user.id },
    orderBy: { scheduledAt: 'desc' },
    take: 200,
  });
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      url: j.url,
      status: j.status,
      attempts: j.attempts,
      lastError: j.lastError,
      scheduledAt: j.scheduledAt,
      finishedAt: j.finishedAt,
    })),
  });
}
