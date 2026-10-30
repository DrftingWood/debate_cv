import Link from 'next/link';
import { DownloadSimple } from '@/components/ui/icons';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { CvReportsTable, type CvReportRow } from '@/components/admin/CvReportsTable';
import { adminHref, type SearchValues } from '@/lib/admin/adminHref';
import type { CvReportList, CvReportView } from '@/lib/admin/cvReports';
import {
  REPORT_FILTER_LABEL,
  REPORT_FILTERS,
  REPORTS_PER_PAGE,
  type ReportFilter,
} from '@/lib/admin/cvReportTypes';
import { publicPieceUrl } from '@/lib/audit/types';
import { relativeTime } from '@/lib/utils/relativeTime';

const HASH = 'cv-reports';

/**
 * Server side of the CV reports ledger: each report as a row the client
 * table shows as it is, its time in words against the page's clock. Every
 * address goes through publicPieceUrl once more here, at the last step
 * before the client: whatever a client component is handed is serialised
 * into the page.
 */
export function toCvReportRows(rows: readonly CvReportView[], now: Date): CvReportRow[] {
  return rows.map((r) => ({
    id: r.id,
    reported: { text: relativeTime(r.createdAt, now), iso: r.createdAt.toISOString() },
    reporter: r.reporter.name ?? r.reporter.email ?? 'Unknown user',
    reporterEmail: r.reporter.name && r.reporter.email ? r.reporter.email : null,
    tournaments: r.tournaments.map((t) => ({
      id: t.id,
      name: t.name,
      stored: t.stored,
      tabUrl: t.tabUrl ? publicPieceUrl(t.tabUrl) : null,
      tab: t.tab,
      suggested: t.suggested.map((p) => ({ ...p, url: p.url ? publicPieceUrl(p.url) : null })),
    })),
    categories: r.categories,
    comment: r.comment,
    status: r.status,
  }));
}

/** "No open reports", "No reports marked won't fix": the empty filter, in words. */
function emptyTitle(status: ReportFilter): string {
  if (status === 'wont_fix') return "No reports marked won't fix";
  if (status === 'all') return 'No CV reports yet';
  return `No ${REPORT_FILTER_LABEL[status].toLowerCase()} reports`;
}

/**
 * "CV error reports" on /admin, where the old list was (Task 5d). The
 * status filter and the pager are plain links that keep the page's other
 * parameters (adminHref), so the parser warnings' page survives a click
 * here, and Back steps through both.
 */
export function CvReportsSection({
  list,
  now,
  search,
}: {
  list: CvReportList;
  now: Date;
  search: SearchValues;
}) {
  const pageHref = (n: number) =>
    adminHref(search, { reportsPage: n > 1 ? String(n) : null }, HASH);
  return (
    <section aria-labelledby={HASH} className="space-y-stack rounded-lg border p-panel">
      <div className="flex flex-wrap items-start justify-between gap-tight">
        <div>
          <h2 id={HASH} className="font-display text-h3 font-medium text-ink">
            CV error reports
          </h2>
          <p className="mt-hair text-body text-ink-soft">
            Reports users sent from their CV page, newest first. Tab says how much of each
            tournament is stored; set a report&rsquo;s status as you work through it.
          </p>
        </div>
        <a
          href="/api/admin/cv-error-reports-export"
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <DownloadSimple className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </a>
      </div>
      {list.anyReports ? <StatusFilter current={list.status} search={search} /> : null}
      {list.total === 0 ? (
        <EmptyState
          title={list.anyReports ? emptyTitle(list.status) : 'No CV reports yet'}
          description={
            list.anyReports
              ? 'Pick another status above to see the rest.'
              : 'A report lands here when a user flags a row on their CV as wrong.'
          }
          headingLevel={3}
        />
      ) : (
        <>
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            perPage={REPORTS_PER_PAGE}
            label="CV report pages"
            href={pageHref}
            always
          />
          <CvReportsTable rows={toCvReportRows(list.rows, now)} />
        </>
      )}
    </section>
  );
}

/** Open, Acknowledged, Fixed, Won't fix, All: links, the current one marked (UX-12). */
function StatusFilter({ current, search }: { current: ReportFilter; search: SearchValues }) {
  return (
    <nav aria-label="Show CV reports by status">
      <ul className="flex flex-wrap gap-inline">
        {REPORT_FILTERS.map((f) => (
          <li key={f}>
            <Link
              href={adminHref(
                search,
                { reportsStatus: f === 'open' ? null : f, reportsPage: null },
                HASH,
              )}
              aria-current={f === current ? 'page' : undefined}
              className={buttonClasses({
                variant: f === current ? 'primary' : 'outline',
                size: 'sm',
              })}
            >
              {REPORT_FILTER_LABEL[f]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
