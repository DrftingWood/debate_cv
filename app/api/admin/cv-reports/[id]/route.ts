import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { REPORT_STATUSES, RESOLVED_STATUSES } from '@/lib/admin/cvReportTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH { status } → { ok: true }: moves a CV error report through open,
 * acknowledged, fixed and won't fix, from the Status select on the /admin
 * ledger. Fixed and won't fix close the report, so they stamp `resolvedAt`
 * (the user's /settings/reports page reads it); any other status reopens
 * it and clears the stamp. Admin only; errors are codes, worded by the page
 * (lib/admin/actionMessage.ts): 400 bad_request, 401/403, 404 not_found.
 */

const Body = z.object({ status: z.enum(REPORT_STATUSES) });

// A cuid; anything else cannot be a report, so it is refused before a query.
const ID = /^[a-z0-9]{1,64}$/i;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status;
    return NextResponse.json(
      { error: status === 403 ? 'forbidden' : 'unauthorized' },
      { status: status === 403 ? 403 : 401 },
    );
  }
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!ID.test(id) || !parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { status } = parsed.data;
  try {
    // updateMany, so a report that is gone is a count of 0 (a 404), not a
    // thrown P2025 to tell apart from a real failure.
    const { count } = await prisma.cvErrorReport.updateMany({
      where: { id },
      data: { status, resolvedAt: RESOLVED_STATUSES.includes(status) ? new Date() : null },
    });
    if (count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[cv-reports] update failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
