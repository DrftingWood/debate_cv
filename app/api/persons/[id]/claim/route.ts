import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const { id } = await ctx.params;
    let personId: bigint;
    try {
      personId = BigInt(id);
    } catch {
      return NextResponse.json({ error: 'bad_id' }, { status: 400 });
    }

    // Single conditional update — avoids the TOCTOU gap between a findUnique
    // and a subsequent update that can cause lost-update races.
    // Case 1: row unclaimed → WHERE matches → claimed atomically.
    // Case 2: row already claimed by this user → WHERE matches → no-op.
    // Case 3: row claimed by someone else → WHERE fails → count = 0 → 409.
    const updated = await prisma.person.updateMany({
      where: { id: personId, OR: [{ claimedByUserId: null }, { claimedByUserId: session.user.id }] },
      data: { claimedByUserId: session.user.id },
    });

    if (updated.count === 0) {
      // Row doesn't exist or is claimed by a different user.
      const exists = await prisma.person.findUnique({
        where: { id: personId },
        select: { id: true },
      });
      return NextResponse.json(
        { error: exists ? 'already_claimed' : 'not_found' },
        { status: exists ? 409 : 404 },
      );
    }

    return NextResponse.json({ ok: true, personId: personId.toString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/persons/claim]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const { id } = await ctx.params;
    let personId: bigint;
    try {
      personId = BigInt(id);
    } catch {
      return NextResponse.json({ error: 'bad_id' }, { status: 400 });
    }

    await prisma.person.updateMany({
      where: { id: personId, claimedByUserId: session.user.id },
      data: { claimedByUserId: null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/persons/claim DELETE]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
