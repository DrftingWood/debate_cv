import { CvReportsSection } from '@/components/admin/CvReportsSection';
import { marksFor, type Mark } from '@/lib/admin/adminChecks';
import { listCvReports, type CvReportList } from '@/lib/admin/cvReports';
import { readPage, readReportFilter } from '@/lib/admin/cvReportTypes';
import { heldReportMarks, reportCounts } from '@/lib/admin/reportsChecked';
import { orNull } from '@/lib/admin/orNull';
import type { SearchValues } from '@/lib/admin/adminHref';

/**
 * CV error reports, paged through `?reportsPage=` and filtered by
 * `?reportsStatus=`: open by default (what needs the owner), another status,
 * all, or `checked` (the reports whose mark still holds, with Undo).
 */
export async function ReportsTab({ search, now }: { search: SearchValues; now: Date }) {
  const page = readPage(search.reportsPage);
  const checkedView = search.reportsStatus === 'checked';
  const read = checkedView ? readChecked(page) : readStatus(search, page);
  const [result, counts] = await Promise.all([
    read.catch(orNull('CV reports')),
    reportCounts().catch(orNull('CV report counts')),
  ]);
  return (
    <CvReportsSection
      list={result?.list ?? null}
      marks={result?.marks}
      counts={counts ?? undefined}
      checkedView={checkedView}
      now={now}
      search={search}
    />
  );
}

type Read = { list: CvReportList; marks: Map<string, Mark> };

/** The page's reports with the marks that sit on them. */
async function readStatus(search: SearchValues, page: number): Promise<Read> {
  const list = await listCvReports({ page, status: readReportFilter(search.reportsStatus) });
  const marks = await marksFor(
    'report',
    list.rows.map((r) => r.id),
  );
  return { list, marks };
}

/** The reports whose mark still holds, newest report first, with who marked them. */
async function readChecked(page: number): Promise<Read> {
  const marks = await heldReportMarks();
  const list = await listCvReports({ page, status: 'all', ids: [...marks.keys()] });
  return { list, marks };
}
