import { NextResponse } from 'next/server';
import { z } from 'zod';
import { IngestJobStatus } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { privateUrlVariants } from '@/lib/gmail/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  url: z.string().url(),
  locked: z.boolean(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: 'bad_request', details: parse.error.flatten() }, { status: 400 });
  }

  const userId = session.user.id;
  const urlVariants = privateUrlVariants(parse.data.url);
  const updated = await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: urlVariants } },
    data: { reingestLocked: parse.data.locked },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (parse.data.locked) {
    await prisma.ingestJob.deleteMany({
      where: {
        userId,
        url: { in: urlVariants },
        status: IngestJobStatus.pending,
      },
    });
  }

  return NextResponse.json({ locked: parse.data.locked, updated: updated.count });
}
