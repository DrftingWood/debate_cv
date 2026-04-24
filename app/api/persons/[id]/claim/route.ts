import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
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

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (person.claimedByUserId && person.claimedByUserId !== session.user.id) {
    return NextResponse.json({ error: 'already_claimed' }, { status: 409 });
  }

  await prisma.person.update({
    where: { id: personId },
    data: { claimedByUserId: session.user.id },
  });

  return NextResponse.json({ ok: true, personId: personId.toString() });
}

export async function DELETE(_req: Request, ctx: Ctx) {
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
}
