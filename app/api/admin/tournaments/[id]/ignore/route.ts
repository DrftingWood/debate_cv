import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sets or clears Tournament.ignored, admin only: an ignored tournament (a
 * test or demo one) leaves the admin scores, Inbox and lists. Nothing else
 * changes, and no user's CV is touched. Idempotent: { ignored } says the
 * state wanted, not a toggle, so a double press cannot flip it back.
 * Answers { ignored }; errors are codes only.
 */
const Body = z.object({ ignored: z.boolean() }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const { id } = await params;
  // Digits only: BigInt() alone would accept '0x10', ' 5 ' and the like.
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const { count } = await prisma.tournament.updateMany({
      where: { id: BigInt(id) },
      data: { ignored: parsed.data.ignored },
    });
    if (count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ignored: parsed.data.ignored });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/tournaments/ignore' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
