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
