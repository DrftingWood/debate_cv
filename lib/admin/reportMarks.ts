import { prisma } from '@/lib/db';
import { fingerprintOf, type MarkInput } from '@/lib/admin/adminChecks';

/**
 * "Mark checked" on a CV report means acknowledged (Task R6, owner:
 * "Reports ... with Mark checked meaning acknowledged"). The admin has looked
 * at it, so an open report moves to acknowledged; it must not stay "open"
 * with a mark beside it, or the Reports tab's Open filter would still list
 * it.
 *
 * That changes what the mark's fingerprint has to say. The page sent the
 * fingerprint of the status it SAW ("open"); once the report is
 * acknowledged the Inbox compares the mark with "acknowledged", the two
 * differ, and the mark would lapse the moment it was stored. So the
 * fingerprint is worked out here, from the status the report has after the
 * move, never taken from the client. A report that has since been fixed or
 * closed keeps its own status; one that no longer exists gets no mark.
 */
export async function acknowledgeReports<T extends Pick<MarkInput, 'kind' | 'subject'>>(
  items: readonly (T & { fingerprint: string })[],
): Promise<Array<T & { fingerprint: string }>> {
  const ids = [...new Set(items.filter((i) => i.kind === 'report').map((i) => i.subject))];
  if (ids.length === 0) return [...items];
  await prisma.cvErrorReport.updateMany({
    where: { id: { in: ids }, status: 'open' },
    data: { status: 'acknowledged' },
  });
  const rows = await prisma.cvErrorReport.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  const status = new Map(rows.map((r) => [r.id, r.status] as const));
  return items.flatMap((item) => {
    if (item.kind !== 'report') return [item];
    const now = status.get(item.subject);
    return now ? [{ ...item, fingerprint: fingerprintOf('report', { status: now }) }] : [];
  });
}
