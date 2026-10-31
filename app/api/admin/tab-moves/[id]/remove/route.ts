import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAdmin } from '@/lib/admin';
import { removeTabMove } from '@/lib/calicotab/tabMoves';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Takes a tab move off the list, admin only: the old address is read as it is again. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    if (!(await removeTabMove(BigInt(id))))
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ removed: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/tab-moves/remove' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
