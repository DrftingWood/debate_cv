import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import {
  REGIONS,
  TOURNAMENT_FORMATS,
  YEAR_MAX,
  YEAR_MIN,
  setTournamentDetails,
} from '@/lib/admin/tournamentDetails';
import { runAudit } from '@/lib/audit/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sets a tournament's format, year or region by hand, admin only
 * (lib/admin/tournamentDetails.ts). Only the fields sent change; null clears
 * one and hands it back to the automatic fill. The tournament is audited
 * again, so its Format check follows. Answers the saved details; errors are
 * codes only.
 */
const Body = z
  .object({
    format: z.enum(TOURNAMENT_FORMATS).nullable().optional(),
    year: z.number().int().min(YEAR_MIN).max(YEAR_MAX).nullable().optional(),
    region: z.enum(REGIONS).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const saved = await setTournamentDetails(BigInt(id), parsed.data);
    if (!saved) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // The checks follow the new values; a failed audit leaves the save standing.
    await runAudit([BigInt(id)]).catch((err: unknown) => {
      Sentry.captureException(err, { tags: { route: 'api/admin/tournaments/details:audit' } });
    });
    return NextResponse.json(saved);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'api/admin/tournaments/details' } });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
