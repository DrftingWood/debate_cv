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
  const userId = session.user.id;

  const [pending, claimsCount] = await Promise.all([
    prisma.person.findMany({
      where: {
        claimedByUserId: null,
        rejections: { none: { userId } },
        discoveredOnUrls: { some: { userId } },
      },
      include: {
        discoveredOnUrls: {
          where: { userId },
          include: { tournament: true },
        },
      },
      orderBy: { displayName: 'asc' },
      take: 100,
    }),
    prisma.person.count({ where: { claimedByUserId: userId } }),
  ]);

  return NextResponse.json({
    hasExistingClaims: claimsCount > 0,
    pending: pending.map((p) => ({
      personId: p.id.toString(),
      displayName: p.displayName,
      tournaments: p.discoveredOnUrls
        .map((u) => u.tournament)
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map((t) => ({
          id: t.id.toString(),
          name: t.name,
          year: t.year,
          host: t.sourceHost,
        })),
    })),
  });
}
