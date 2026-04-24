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
    await prisma.personRejection.upsert({
      where: { userId_personId: { userId: session.user.id, personId } },
      update: {},
      create: { userId: session.user.id, personId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/persons/reject POST]', msg);
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
    await prisma.personRejection.deleteMany({
      where: { userId: session.user.id, personId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/persons/reject DELETE]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
