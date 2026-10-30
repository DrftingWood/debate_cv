import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import {
  rescrapePieces,
  ScrapeBusyError,
  TournamentNotFoundError,
} from '@/lib/calicotab/partialScrape';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A rescrape fetches live pages; the deadline below keeps it inside this.
export const maxDuration = 60;

// Stop fetching 5s before the platform would kill the function, so the write
// still happens and a slow page costs a failed piece, not a lost request.
const DEADLINE_MS = 55_000;

const Body = z.object({
  pieces: z.union([
    z.literal('failed'),
    z
      .array(
        z.object({
          kind: z.enum(['team', 'speaker', 'participants', 'motions', 'break', 'round']),
          key: z.string().max(300),
        }),
      )
      .max(40),
  ]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const { id } = await params;
  let tournamentId: bigint;
  try {
    tournamentId = BigInt(id);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const r = await rescrapePieces(tournamentId, parsed.data.pieces, {
      deadline: Date.now() + DEADLINE_MS,
    });
    return NextResponse.json({ loaded: r.loaded, failed: r.failed, notOnTab: r.notOnTab });
  } catch (err) {
    if (err instanceof ScrapeBusyError) {
      return NextResponse.json({ error: 'scrape_busy' }, { status: 409 });
    }
    if (err instanceof TournamentNotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // Anything else is unexpected: let it reach Sentry rather than leak a message.
    throw err;
  }
}
