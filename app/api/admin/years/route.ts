import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { fillYearsBatch } from '@/lib/admin/yearFill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The Tools tab's "Fill years from names", admin only, with no fetch:
 * { fillMissing: true, after? } reads the year out of the name of the next
 * tournaments that have none and answers { filled, noYear, left, next };
 * `next` is the cursor to send as `after` for the following press. Errors are
 * codes only.
 */

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
    return NextResponse.json(await fillYearsBatch(after));
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/years' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
