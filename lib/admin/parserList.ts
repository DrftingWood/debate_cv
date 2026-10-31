import { clampPage } from '@/lib/admin/cvReportTypes';
import { allParserGroups } from '@/lib/admin/inbox';
import { classifyWarning } from '@/lib/admin/parserClass';
import {
  loadWarningGroups,
  warningViews,
  WARNINGS_PER_PAGE,
  type ParserWarningView,
  type WarningGroup,
} from '@/lib/admin/parserWarnings';

/**
 * The Parser tab (Task R6): the parser's warnings, split by whether they
 * need the owner (parserClass.ts, the same split the Inbox uses).
 *
 *   - problems (default): faults in reading a page that no matching mark
 *     covers. Its count is the Inbox's parser figure, read through the same
 *     helper;
 *   - info: how a tournament chose to publish its tab ("competition likely
 *     finished", "(optional)", "not released"): expected states, listed so
 *     they can be seen but never ranked as problems or marked;
 *   - checked: problem groups an admin marked whose mark still holds (a
 *     group that grew into a new bucket comes back under problems).
 */

export const PARSER_FILTERS = ['problems', 'info', 'checked'] as const;
export type ParserFilter = (typeof PARSER_FILTERS)[number];

/** `?parser=` as a filter; anything unknown (or nothing) is the default, problems. */
export function readParserFilter(v: string | string[] | undefined): ParserFilter {
  const s = Array.isArray(v) ? v[0] : v;
  return PARSER_FILTERS.find((f) => f === s) ?? 'problems';
}

export type ParserRowData = ParserWarningView & {
  /** What "Mark checked" stores; null on an informational group (nothing to mark). */
  fingerprint: string | null;
  checked: { by: string; at: Date } | null;
  changed: boolean;
};

export type ParserList = {
  rows: ParserRowData[];
  total: number;
  page: number;
  pages: number;
  filter: ParserFilter;
  /** Groups of each view, whatever the filter: the chips' figures. */
  counts: Record<ParserFilter, number>;
};

type Entry = {
  g: WarningGroup;
  fingerprint: string | null;
  checked: ParserRowData['checked'];
  changed: boolean;
};

export async function listParser({
  filter,
  page,
  now,
}: {
  filter: ParserFilter;
  page: number;
  now: Date;
}): Promise<ParserList> {
  const [problemGroups, everything] = await Promise.all([
    allParserGroups(now),
    loadWarningGroups(now),
  ]);
  const problems: Entry[] = [];
  const checked: Entry[] = [];
  for (const { g, fingerprint, state, mark } of problemGroups) {
    if (state === 'covered' && mark) {
      const by = { by: mark.checkedBy, at: mark.checkedAt };
      checked.push({ g, fingerprint, checked: by, changed: false });
    } else {
      problems.push({ g, fingerprint, checked: null, changed: state === 'changed' });
    }
  }
  const info: Entry[] = everything
    .filter((g) => classifyWarning(g.headline) === 'info')
    .map((g) => ({ g, fingerprint: null, checked: null, changed: false }));
  const counts = { problems: problems.length, info: info.length, checked: checked.length };

  const all = { problems, info, checked }[filter];
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / WARNINGS_PER_PAGE));
  const shown = clampPage(page, pages);
  const slice = all.slice((shown - 1) * WARNINGS_PER_PAGE, shown * WARNINGS_PER_PAGE);
  const views = await warningViews(slice.map((e) => e.g));
  const rows = views.map((view, i): ParserRowData => ({
    ...view,
    fingerprint: slice[i]?.fingerprint ?? null,
    checked: slice[i]?.checked ?? null,
    changed: slice[i]?.changed ?? false,
  }));
  return { rows, total, page: shown, pages, filter, counts };
}
