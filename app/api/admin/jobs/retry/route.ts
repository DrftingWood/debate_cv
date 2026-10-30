import { NextResponse } from 'next/server';
import { z } from 'zod';
import { IngestJobStatus } from '@prisma/client';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.union([
  z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Only dead jobs are touched, whatever ids were sent: resetting a running
  // job would let a second worker pick up the same URL.
  const dead = { in: [IngestJobStatus.failed, IngestJobStatus.abandoned] };
  const where =
    'ids' in parsed.data ? { id: { in: parsed.data.ids }, status: dead } : { status: dead };

  const deadJobs = await prisma.ingestJob.findMany({
    where,
    select: { id: true, userId: true, url: true },
  });
  // A locked URL is the user's "don't touch this" flag; reingest-all and
  // enqueueUrl honour it, so a bulk retry must too.
  const locked = deadJobs.length
    ? await prisma.discoveredUrl.findMany({
        where: {
          reingestLocked: true,
          userId: { in: [...new Set(deadJobs.map((j) => j.userId))] },
        },
        select: { userId: true, url: true },
      })
    : [];
  const lockedKeys = new Set(
    locked.map(
      (l) => `${l.userId}
${l.url}`,
    ),
  );
  const eligible = deadJobs.filter(
    (j) =>
      !lockedKeys.has(`${j.userId}
${j.url}`),
  );
  if (eligible.length === 0) {
    return NextResponse.json({ requeued: 0, skippedLocked: deadJobs.length });
  }

  const { count } = await prisma.ingestJob.updateMany({
    where: { id: { in: eligible.map((j) => j.id) }, status: dead },
    data: {
      status: IngestJobStatus.pending,
      attempts: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
      scheduledAt: new Date(),
    },
  });
  return NextResponse.json({ requeued: count, skippedLocked: deadJobs.length - eligible.length });
}
