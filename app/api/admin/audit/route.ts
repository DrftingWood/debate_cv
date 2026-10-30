import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { auditStale, runAudit } from '@/lib/audit/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// "Audit now" for stale tournaments is one bounded batch: the admin gets an
// answer inside the function's lifetime, and the cron's sweep picks up the
// rest. The deadline leaves 5s before the platform would kill the function.
const STALE_LIMIT = 100;
const DEADLINE_MS = 55_000;

// Digits only, as in the rescrape route: BigInt() alone would accept '0x10'
// and ' 5 '. Strict objects so a body carrying both shapes is refused.
const Body = z.union([
  z.object({ tournamentId: z.string().regex(/^\d{1,18}$/) }).strict(),
  z.object({ stale: z.literal(true) }).strict(),
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
    const audited =
      'stale' in parsed.data
        ? await auditStale({ limit: STALE_LIMIT, deadline: Date.now() + DEADLINE_MS })
        : await runAudit([BigInt(parsed.data.tournamentId)]);
    return NextResponse.json({ audited });
  } catch (err) {
    // Report it, but give the UI a code rather than a raw message.
    Sentry.captureException(err, { tags: { route: 'api/admin/audit' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
