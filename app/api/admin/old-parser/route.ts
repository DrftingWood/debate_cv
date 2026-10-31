import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { refreshOldParser, refreshTournament } from '@/lib/admin/oldParserFill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The Tools tab's "Refresh old-parser tournaments", admin only:
 * { tournamentId } is the Fix for one tournament: the same refresh, answering
 * { result: 'refreshed' | 'failed' }. { refresh: true, after? } re-reads every recorded page of the next few
 * tournaments stored by an older parser, through the partial re-scrape (never
 * a full re-ingest), and answers { refreshed, failed, left, next }; `next` is
 * the cursor to send as `after` for the following press. It fetches, so a
 * press is bounded in count and by this deadline. Errors are codes only.
 */

// Stop starting tournaments before the platform would kill the function;
// refreshOldParser keeps a further tail of its own for the re-audit.
const DEADLINE_MS = 55_000;

// Digits only, as in the other admin routes: BigInt() alone would accept '0x10'.
const Id = z.string().regex(/^\d{1,18}$/);
const Body = z.union([
  // The Tools tab's batch.
  z.object({ refresh: z.literal(true), after: Id.optional() }).strict(),
  // The Inbox's and the detail page's Fix for one tournament.
  z.object({ tournamentId: Id }).strict(),
]);

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
    const deadline = Date.now() + DEADLINE_MS;
    if ('tournamentId' in parsed.data) {
      const result = await refreshTournament(BigInt(parsed.data.tournamentId), { deadline });
      return NextResponse.json({ result });
    }
    const after = parsed.data.after != null ? BigInt(parsed.data.after) : null;
    return NextResponse.json(await refreshOldParser(after, { deadline }));
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/old-parser' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
