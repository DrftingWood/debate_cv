import { prisma } from '@/lib/db';
import { fingerprintOf, listMarks, type Mark } from '@/lib/admin/adminChecks';

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
