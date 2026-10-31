import { prisma } from '@/lib/db';
import { fingerprintOf, listMarks, type Mark } from '@/lib/admin/adminChecks';
import type { ReportFilter } from '@/lib/admin/cvReportTypes';

/**
 * The CV reports whose mark still holds (the Reports tab's Checked filter),
 * with the mark. A report marked and then moved to another status has a
 * mark about the old status: it is not "checked" any more and is left out
 * (its status filter shows it). Reports are checked by id, in one query, so
 * the cost does not grow with the reports table.
 */
export async function heldReportMarks(): Promise<Map<string, Mark>> {
  const marks = await listMarks('report');
  if (marks.size === 0) return marks;
  const rows = await prisma.cvErrorReport.findMany({
    where: { id: { in: [...marks.keys()] } },
    select: { id: true, status: true },
  });
  const held = new Map<string, Mark>();
  for (const r of rows) {
    const mark = marks.get(r.id);
    if (mark && mark.fingerprint === fingerprintOf('report', { status: r.status })) {
      held.set(r.id, mark);
    }
  }
  return held;
}

/**
 * The Reports tab's chip figures: reports in each status, all of them, and
 * the checked ones (marks that still hold). The status counts are one
 * grouped query; the checked count is heldReportMarks.
 */
export async function reportCounts(): Promise<Record<ReportFilter | 'checked', number>> {
  const [groups, held] = await Promise.all([
    prisma.cvErrorReport.groupBy({ by: ['status'], _count: { _all: true } }),
    heldReportMarks(),
  ]);
  const counts: Record<ReportFilter | 'checked', number> = {
    open: 0,
    acknowledged: 0,
    fixed: 0,
    wont_fix: 0,
    all: 0,
    checked: held.size,
  };
  for (const g of groups) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }
  return counts;
}
