import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { lookupTournament } from '@/lib/admin/tournamentLookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ url: z.string().min(1).max(500) });

/**
 * The admin lookup panel's "Look up": is the tournament behind this URL
 * stored? Reads only. The URL may be a private one; it is parsed to host and
 * slug here and the answer never carries it back (lookupTournament).
 * Dates go out as ISO strings, which NextResponse.json does for a Date.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    return NextResponse.json(await lookupTournament(parsed.data.url));
  } catch (err) {
    // Logged without the URL: it may hold a private key.
    console.error('[admin/lookup] lookup failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
