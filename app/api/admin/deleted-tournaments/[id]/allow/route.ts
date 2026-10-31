import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAdmin } from '@/lib/admin';
import { allowAgain } from '@/lib/admin/deletedTournaments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Takes a deleted tab address off the list, admin only, so its tournament
 * can be ingested again. Nothing is fetched or restored: the next import or
 * pre-scrape of the tab stores it afresh. Answers { allowed: true }; 404
 * when the address is not on the list.
 */
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
    if (!(await allowAgain(BigInt(id))))
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ allowed: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/deleted-tournaments/allow' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
