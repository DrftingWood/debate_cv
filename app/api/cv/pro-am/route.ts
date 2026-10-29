import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { prisma } from '@/lib/db';
import { MAX_PRO_AM_MARKS, proAmKey } from '@/lib/cv/proAm';
import { normalizePersonNameV2 } from '@/lib/calicotab/fingerprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  tournamentId: z.string().regex(/^\d{1,18}$/),
  partner: z.string().trim().min(1).max(200),
  marked: z.boolean(),
});

/**
 * POST — mark or unmark one partner at one tournament as pro-am (redesign
 * owner decision 17; lib/cv/proAm.ts). Only a tournament on the user's own
 * record can carry a mark, the same ownership test the error-report route
 * uses (a DiscoveredUrl for it).
 *
 * One atomic UPDATE each way, so two quick taps on different partners never
 * lose one another's write the way a read-modify-write of the array would.
 * A raw UPDATE skips Prisma's @updatedAt, so it sets "updatedAt" itself.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const limited = await enforceRateLimit('cv:proAm', userId);
  if (limited) return limited;

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: 'bad_request', details: z.flattenError(parse.error) },
      { status: 400 },
    );
  }
  const { tournamentId, partner, marked } = parse.data;
  if (normalizePersonNameV2(partner) === '') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const owned = await prisma.discoveredUrl.findFirst({
    where: { userId, tournamentId: BigInt(tournamentId) },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: 'not_on_record' }, { status: 404 });

  const key = proAmKey(tournamentId, partner);
  if (marked) {
    const changed = await prisma.$executeRaw`
      UPDATE "User"
      SET "proAmMarks" = array_append("proAmMarks", ${key}), "updatedAt" = NOW()
      WHERE id = ${userId}
        AND NOT (${key} = ANY("proAmMarks"))
        AND cardinality("proAmMarks") < ${MAX_PRO_AM_MARKS}`;
    if (changed === 0) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { proAmMarks: true },
      });
      // Already marked is a success; the cap is the only refusal.
      if (!user?.proAmMarks.includes(key)) {
        return NextResponse.json({ error: 'too_many_marks' }, { status: 409 });
      }
    }
  } else {
    await prisma.$executeRaw`
      UPDATE "User"
      SET "proAmMarks" = array_remove("proAmMarks", ${key}), "updatedAt" = NOW()
      WHERE id = ${userId}`;
  }
  return NextResponse.json({ marked });
}
