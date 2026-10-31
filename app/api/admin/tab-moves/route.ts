import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { addTabMove } from '@/lib/calicotab/tabMoves';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Records that a tab moved, admin only (lib/calicotab/tabMoves.ts): every
 * URL to the old site and slug is read from the new one, and the old
 * address's failed imports go back in the queue. Only the sites are kept,
 * never a private key. Answers { added, requeued }; a bad address is
 * `invalid_from`, `invalid_to` (not an https tab site) or `same`.
 */
const Body = z
  .object({ from: z.string().trim().min(1).max(500), to: z.string().trim().min(1).max(500) })
  .strict();

export async function POST(req: Request) {
  let admin: string;
  try {
    admin = await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const outcome = await addTabMove(parsed.data.from, parsed.data.to, admin);
    if (outcome.kind === 'invalid')
      return NextResponse.json({ error: `invalid_${outcome.reason}` }, { status: 400 });
    return NextResponse.json({ added: true, requeued: outcome.requeued });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/tab-moves' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
