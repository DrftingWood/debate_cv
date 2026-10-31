import Link from 'next/link';
import { DownloadSimple } from '@/components/ui/icons';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { CheckActionsProvider } from '@/components/admin/CheckActions';
import { CvReportsTable, type CvReportRow } from '@/components/admin/CvReportsTable';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { fingerprintOf, type Mark } from '@/lib/admin/adminChecks';
import { adminHref, type SearchValues } from '@/lib/admin/adminHref';
import { markCell } from '@/lib/admin/markCell';
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
 *
 * An open or acknowledged report carries "Mark checked", which acknowledges
 * it (the route stores the fingerprint of the status it then has); one whose
 * mark still holds carries "Checked by X on D · Undo" instead, and one whose
 * status moved since its mark shows "Changed since you checked it".
 */
export function toCvReportRows(
  rows: readonly CvReportView[],
  now: Date,
  marks: ReadonlyMap<string, Mark> = new Map(),
): CvReportRow[] {
  return rows.map((r) => {
    const mark = marks.get(r.id);
    const holds = !!mark && mark.fingerprint === fingerprintOf('report', { status: r.status });
    const markable = r.status === 'open' || r.status === 'acknowledged';
    return {
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
      mark:
        holds || markable
          ? markCell({
              kind: 'report',
              subject: r.id,
              fingerprint: fingerprintOf('report', { status: 'acknowledged' }),
              checked: holds && mark ? { by: mark.checkedBy, at: mark.checkedAt } : null,
              changed: !!mark && !holds,
            })
          : null,
    };
  });
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
 *
 * Open reports come first (what needs the owner); `checkedView` is the
 * Checked filter (`?reportsStatus=checked`), whose `list` holds the reports
 * with a mark that still holds and `marks` says who and when, for Undo.
 */
export function CvReportsSection({
  list,
  now,
  search,
  marks,
  checkedView = false,
}: {
  /** Null when the read failed: the section says so. */
  list: CvReportList | null;
  now: Date;
  search: SearchValues;
  /** The marks of the reports on the page, by report id. */
  marks?: ReadonlyMap<string, Mark>;
  checkedView?: boolean;
}) {
  return (
    <section aria-labelledby={HASH} className="space-y-stack rounded-lg border p-panel">
      <div className="flex flex-wrap items-start justify-between gap-tight">
        <div>
          <h2 id={HASH} className="font-display text-h3 font-medium text-ink">
            CV error reports
          </h2>
          <p className="mt-hair text-body text-ink-soft">
            {checkedView
              ? 'Reports you marked checked. Undo puts one back; Mark checked on an open report acknowledges it.'
              : 'Reports users sent from their CV page, newest first. Open ones need you: Mark checked acknowledges a report once you have looked at it. Tab says how much of each tournament is stored.'}
          </p>
        </div>
        <a
          href="/api/admin/cv-error-reports-export"
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <DownloadSimple className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </a>
      </div>
      {list?.anyReports || checkedView ? (
        <StatusFilter current={checkedView ? null : (list?.status ?? 'open')} search={search} />
      ) : null}
      {list ? (
        <Listing list={list} now={now} search={search} marks={marks} checkedView={checkedView} />
      ) : (
        <LoadFailed what="the CV reports" />
      )}
    </section>
  );
}

/** One page of reports, or the empty state that says why there are none. */
function Listing({
  list,
  now,
  search,
  marks,
  checkedView,
}: {
  list: CvReportList;
  now: Date;
  search: SearchValues;
  marks?: ReadonlyMap<string, Mark>;
  checkedView: boolean;
}) {
  if (list.total === 0) {
    const none = list.anyReports ? emptyTitle(list.status) : 'No CV reports yet';
    return (
      <EmptyState
        title={checkedView ? 'Nothing is marked checked' : none}
        description={
          checkedView
            ? 'Press Mark checked on an open report and it waits here, with Undo.'
            : list.anyReports
              ? 'Pick another status above to see the rest.'
              : 'A report lands here when a user flags a row on their CV as wrong.'
        }
        headingLevel={3}
      />
    );
  }
  return (
    <>
      <Pager
        page={list.page}
        pages={list.pages}
        total={list.total}
        perPage={REPORTS_PER_PAGE}
        label="CV report pages"
        href={(n) => adminHref(search, { reportsPage: n > 1 ? String(n) : null }, HASH)}
        always
      />
      <CheckActionsProvider>
        <CvReportsTable rows={toCvReportRows(list.rows, now, marks)} />
      </CheckActionsProvider>
    </>
  );
}

/** Open, Acknowledged, Fixed, Won't fix, All: links, the current one marked (UX-12). */
function StatusFilter({
  current,
  search,
}: {
  /** The chosen status; null when the Checked view is. */
  current: ReportFilter | null;
  search: SearchValues;
}) {
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
        <li>
          <Link
            href={adminHref(search, { reportsStatus: 'checked', reportsPage: null }, HASH)}
            aria-current={current === null ? 'page' : undefined}
            className={buttonClasses({
              variant: current === null ? 'primary' : 'outline',
              size: 'sm',
            })}
          >
            Checked
          </Link>
        </li>
      </ul>
    </nav>
  );
}
