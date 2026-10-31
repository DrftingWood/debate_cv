import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { deleteTournament } from '@/lib/admin/deletedTournaments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deletes a tournament, admin only, and records its tab address so it is
 * never ingested again (lib/admin/deletedTournaments.ts). The body must say
 * { confirm: true }: the page asks twice, and a bare POST deletes nothing.
 * A tournament on anyone's CV is refused with 409 `on_cvs` and its user
 * count. Answers { deleted: true, name }; errors are codes only.
 */
const Body = z.object({ confirm: z.literal(true) }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin: string;
  try {
    admin = await requireAdmin();
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
    const outcome = await deleteTournament(BigInt(id), admin);
    if (outcome.kind === 'not_found')
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (outcome.kind === 'on_cvs')
      return NextResponse.json({ error: 'on_cvs', users: outcome.users }, { status: 409 });
    return NextResponse.json({ deleted: true, name: outcome.name });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/tournaments/delete' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
