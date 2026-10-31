import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { fillFormats, fillMissingBatch } from '@/lib/admin/formatFill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Fills a missing Tournament.format from the stored data (lib/admin/formatFill.ts),
 * admin only, with no network fetch:
 *   - { tournamentId } is the check's "Infer format": → { decided, format };
 *     decided:false means the stored rows could not settle it and the page
 *     offers a re-scrape of R1 and the team tab instead;
 *   - { fillMissing: true, after? } is the Tools tab's "Fill missing formats":
 *     one bounded batch → { filled, undecided, left, next }, `next` being the
 *     cursor to send as `after` for the following press.
 * Each fill re-audits the tournaments it filled before replying, so the page
 * the admin sees next already shows the new score. Errors are codes only.
 */

// Digits only, as in the audit route: BigInt() alone would accept '0x10'.
// Strict objects so a body carrying both shapes is refused.
const Id = z.string().regex(/^\d{1,18}$/);
const Body = z.union([
  z.object({ tournamentId: Id }).strict(),
  z.object({ fillMissing: z.literal(true), after: Id.optional() }).strict(),
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
    if ('fillMissing' in parsed.data) {
      const after = parsed.data.after != null ? BigInt(parsed.data.after) : null;
      return NextResponse.json(await fillMissingBatch(after));
    }
    const id = BigInt(parsed.data.tournamentId);
    const out = await fillFormats([id]);
    const filled = out.filled.at(0);
    if (filled) return NextResponse.json({ decided: true, format: filled.format });
    // A format set since the admin looked is as good as decided.
    if (out.already?.length) return NextResponse.json({ decided: true, format: null });
    if (out.undecided.length) return NextResponse.json({ decided: false, format: null });
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/formats' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
