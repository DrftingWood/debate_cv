import { CvReportsSection } from '@/components/admin/CvReportsSection';
import { listCvReports } from '@/lib/admin/cvReports';
import { readPage, readReportFilter } from '@/lib/admin/cvReportTypes';
import { orNull } from '@/lib/admin/orNull';
import type { SearchValues } from '@/lib/admin/adminHref';

/** CV error reports, paged through `?reportsPage=` and filtered by `?reportsStatus=` (open by default). */
export async function ReportsTab({ search, now }: { search: SearchValues; now: Date }) {
  const list = await listCvReports({
    page: readPage(search.reportsPage),
    status: readReportFilter(search.reportsStatus),
  }).catch(orNull('CV reports'));
  return <CvReportsSection list={list} now={now} search={search} />;
}
