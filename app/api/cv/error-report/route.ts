import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  tournamentIds: z.array(z.string().regex(/^\d+$/)).min(1).max(25),
  comment: z.string().trim().min(8).max(4000),
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
  const requested = [...new Set(parse.data.tournamentIds)];
  const owned = await prisma.discoveredUrl.findMany({
    where: {
      userId,
      tournamentId: { in: requested.map((id) => BigInt(id)) },
    },
    select: { tournamentId: true },
    distinct: ['tournamentId'],
  });
  const ownedIds = new Set(owned.map((row) => row.tournamentId?.toString()).filter(Boolean));
  const tournamentIds = requested.filter((id) => ownedIds.has(id));

  if (tournamentIds.length === 0) {
    return NextResponse.json({ error: 'no_accessible_tournaments' }, { status: 400 });
  }

  const report = await prisma.cvErrorReport.create({
    data: {
      userId,
      tournamentIds,
      comment: parse.data.comment,
    },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json({
    id: report.id,
    createdAt: report.createdAt.toISOString(),
    tournamentCount: tournamentIds.length,
  });
}
