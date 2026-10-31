import { prisma } from '@/lib/db';
import { yearFromName } from '@/lib/admin/yearFromName';
import { YEAR_BATCH_SIZE, type YearFillResponse } from '@/lib/admin/yearFillText';

/**
 * "Fill years from names": a tournament stored with no year gets the one its
 * own name states (yearFromName), with no fetch. A year is only ever written
 * where there is none (the write is guarded on `year: null`, so a scrape that
 * landed meanwhile is not overwritten), and a name that states no single year
 * is left null, so the cursor moves past it instead of meeting it every press.
 * Years feed the CV's season grouping, not the audit, so nothing is re-audited.
 */

/** Tournaments with no year, after `after` by id; ignored tournaments are not offered. */
export function missingYearWhere(after: bigint | null) {
  return { year: null, ignored: false, ...(after != null ? { id: { gt: after } } : {}) };
}

/** Tournaments the Tools tab says have no year. */
export function countMissingYears(): Promise<number> {
  return prisma.tournament.count({ where: missingYearWhere(null) });
}

/** One bounded press: the next YEAR_BATCH_SIZE tournaments with no year after `after`. */
export async function fillYearsBatch(
  after: bigint | null,
  now: Date = new Date(),
): Promise<YearFillResponse> {
  const batch = await prisma.tournament.findMany({
    where: missingYearWhere(after),
    orderBy: { id: 'asc' },
    take: YEAR_BATCH_SIZE,
    select: { id: true, name: true },
  });
  const last = batch.at(-1);
  if (!last) return { filled: 0, noYear: 0, left: 0, next: null };
  let filled = 0;
  let noYear = 0;
  for (const t of batch) {
    const year = yearFromName(t.name, now);
    if (year == null) {
      noYear += 1;
      continue;
    }
    const { count } = await prisma.tournament.updateMany({
      where: { id: t.id, year: null },
      data: { year },
    });
    if (count > 0) filled += 1;
  }
  const left = await prisma.tournament.count({ where: missingYearWhere(last.id) });
  return { filled, noYear, left, next: left > 0 ? String(last.id) : null };
}
