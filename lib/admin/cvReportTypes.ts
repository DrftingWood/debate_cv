/**
 * The CV reports ledger's vocabulary, apart from its database code
 * (lib/admin/cvReports.ts) so the client table and its status select can
 * import it without pulling Prisma into the browser bundle.
 */

/** CvReportStatus, in the order a report moves through them. */
export const REPORT_STATUSES = ['open', 'acknowledged', 'fixed', 'wont_fix'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  fixed: 'Fixed',
  wont_fix: "Won't fix",
};

/** `?reportsStatus=`: one status, or every report. */
export const REPORT_FILTERS = [...REPORT_STATUSES, 'all'] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export const REPORT_FILTER_LABEL: Record<ReportFilter, string> = {
  ...REPORT_STATUS_LABEL,
  all: 'All',
};

/** Statuses that close a report: setting one stamps `resolvedAt`. */
export const RESOLVED_STATUSES: readonly ReportStatus[] = ['fixed', 'wont_fix'];

export const REPORTS_PER_PAGE = 20;

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

/** `?reportsStatus=` as a filter; anything unknown (or nothing) is the default, open. */
export function readReportFilter(v: Param): ReportFilter {
  const s = first(v);
  return (REPORT_FILTERS as readonly string[]).includes(s ?? '') ? (s as ReportFilter) : 'open';
}

/** A 1-based page number from the address; anything unreadable is page 1 (the read model clamps the top). */
export function readPage(v: Param): number {
  const n = Number.parseInt(first(v) ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The page to show of `pages`, from whatever was asked for. */
export function clampPage(page: number, pages: number): number {
  return Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), Math.max(1, pages)) : 1;
}
