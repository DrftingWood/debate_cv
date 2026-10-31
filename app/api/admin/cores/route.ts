import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { fillMissingCores } from '@/lib/admin/coreFill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The Tools tab's "Fill missing adjudication cores", admin only:
 * { fillMissing: true, after? } reads the home page (and the participants
 * list, if never read) of the next few tournaments that name no core, through
 * the partial re-scrape, and answers { found, none, failed, left, next };
 * `next` is the cursor to send as `after` for the following press. It fetches,
 * so a press is bounded in count and by this deadline. Errors are codes only.
 */

// Stop starting tournaments before the platform would kill the function;
// fillMissingCores keeps a further tail of its own for the re-audit.
const DEADLINE_MS = 55_000;

// Digits only, as in the other admin routes: BigInt() alone would accept '0x10'.
const Body = z
  .object({
    fillMissing: z.literal(true),
    after: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
  })
  .strict();

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
    const after = parsed.data.after != null ? BigInt(parsed.data.after) : null;
    return NextResponse.json(await fillMissingCores(after, { deadline: Date.now() + DEADLINE_MS }));
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/cores' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
