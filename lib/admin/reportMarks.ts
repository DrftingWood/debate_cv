import { prisma } from '@/lib/db';
import { fingerprintOf, markAllChecked, upsertSql, type MarkInput } from '@/lib/admin/adminChecks';

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
 *
 * The status change and every mark are written in one transaction, so a
 * failure cannot leave a report acknowledged with no mark, or marked with
 * the old status. Returns how many marks were stored.
 */
export async function markWithAcknowledge(marks: readonly MarkInput[]): Promise<number> {
  const ids = [...new Set(marks.filter((m) => m.kind === 'report').map((m) => m.subject))];
  if (ids.length === 0) return markAllChecked([...marks]);
  // Up to 200 upserts in one go: the default 5 s interactive limit is too tight on a cold pool.
  return prisma.$transaction(
    async (tx) => {
      await tx.cvErrorReport.updateMany({
        where: { id: { in: ids }, status: 'open' },
        data: { status: 'acknowledged' },
      });
      const rows = await tx.cvErrorReport.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true },
      });
      const status = new Map(rows.map((r) => [r.id, r.status] as const));
      const stored = marks.flatMap((m): MarkInput[] => {
        if (m.kind !== 'report') return [m];
        const now = status.get(m.subject);
        return now ? [{ ...m, fingerprint: fingerprintOf('report', { status: now }) }] : [];
      });
      for (const m of stored) await tx.$executeRaw(upsertSql(m));
      return stored.length;
    },
    { timeout: 15_000 },
  );
}
