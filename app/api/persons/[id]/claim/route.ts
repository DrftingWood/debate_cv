import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  let personId: bigint;
  try {
    personId = BigInt(id);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // Authorization: a user can only claim a Person attached to a tournament
  // they've actually ingested a private URL for. Without this check, any
  // logged-in user can claim any Person by guessing their numeric id and
  // appear on the CV for tournaments they never participated in.
  const ownership = await prisma.tournamentParticipant.findFirst({
    where: {
      personId,
      tournament: {
        discoveredUrls: { some: { userId: session.user.id } },
      },
    },
    select: { id: true },
  });
  if (!ownership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Single conditional updateMany prevents the read-then-write race that
  // produced 40P01 deadlocks under concurrent claim attempts. The OR clause
  // makes idempotent reclaim by the same user a no-op.
  const updated = await prisma.person.updateMany({
    where: {
      id: personId,
      OR: [{ claimedByUserId: null }, { claimedByUserId: session.user.id }],
    },
    data: { claimedByUserId: session.user.id },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: 'already_claimed_by_other' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, personId: personId.toString() });
}
