import { prisma } from '@/lib/db';
import { clampPage } from '@/lib/admin/cvReportTypes';
import {
  allImportGroups,
  namesOf,
  readFailedJobs,
  type ImportGroupState,
  type JobRow,
} from '@/lib/admin/inbox';
import { CHECK_REASON } from '@/lib/admin/inboxTypes';
import { loadTabStates, type TabState } from '@/lib/admin/tabStatus';
import type { StoredRef } from '@/lib/admin/tournamentLookup';
import { ingestErrorCategory } from '@/lib/ingest/userMessage';

/**
 * The Imports tab (Task R6): failed imports, focused on what needs the
 * owner. Four views over the same two reads the Inbox already makes
 * (inbox.ts: the unstored groups with their marks, and the mirror scan of
 * the stored ones), so the default view's count is the summary line's
 * "Imports to review" by construction, not by a second derivation:
 *
 *   - failing (default): tournaments NOT stored (or not told apart) that no
 *     matching mark covers;
 *   - covered: failed imports whose tournament IS stored, "Covered by stored
 *     copy": the user already has the tournament, so nobody needs to act;
 *   - checked: failing groups an admin marked and whose mark still holds
 *     (a changed failure comes back to "failing", labelled);
 *   - all: all of the above.
 *
 * Rows are one per tournament (host and slug) across users, each with the
 * affected users' emails; a stored one is one per stored tournament. Email
 * addresses are read for the visible page only, and never a private URL.
 */

export const IMPORTS_PER_PAGE = 20;
/** Users named on a row before "+n more". */
export const USERS_SHOWN = 3;

export const IMPORTS_FILTERS = ['failing', 'covered', 'checked', 'all'] as const;
export type ImportsFilter = (typeof IMPORTS_FILTERS)[number];

/** `?imports=` as a filter; anything unknown (or nothing) is the default, failing. */
export function readImportsFilter(v: string | string[] | undefined): ImportsFilter {
  const s = Array.isArray(v) ? v[0] : v;
  return IMPORTS_FILTERS.find((f) => f === s) ?? 'failing';
}

export type ImportRowData = {
  /** The group's mark subject (`host/slug`), or `stored:<id>` for a covered row. */
  key: string;
  section: 'failing' | 'covered';
  name: string;
  tournamentId: string | null;
  /** The public tab address; never a private one. */
  tabUrl: string | null;
  tab: TabState;
  /** The newest job's error in words. */
  error: string;
  attempts: number;
  /** Affected users' emails, the first USERS_SHOWN. */
  users: string[];
  moreUsers: number;
  latest: Date | null;
  jobIds: string[];
  /** What a covered row's stored copy was last scraped; null otherwise. */
  scrapedAt: Date | null;
  /** The fingerprint "Mark checked" stores; null on a covered row (nothing to mark). */
  fingerprint: string | null;
  /** Who marked it and when, while the mark still holds. */
  checked: { by: string; at: Date } | null;
  changed: boolean;
};

export type ImportList = {
  rows: ImportRowData[];
  total: number;
  page: number;
  pages: number;
  filter: ImportsFilter;
  /** Rows of each view, whatever the filter: the chips' figures. */
  counts: { failing: number; covered: number; checked: number };
  /** The job scan hit its page ceiling: older failures were not read. */
  truncated: boolean;
};

const newest = (jobs: readonly JobRow[]): Date | null =>
  jobs.reduce<Date | null>((best, j) => {
    const t = j.finishedAt ?? j.scheduledAt;
    return !best || t > best ? t : best;
  }, null);

/** A failing group as a row (users and the stored-copy facts are filled in later). */
function failingRow({ subject, g, category, fingerprint, state, mark }: ImportGroupState) {
  const row: ImportRowData = {
    key: subject,
    section: 'failing',
    name: g.name,
    tournamentId: null,
    tabUrl: g.tabUrl,
    tab: {
      state: g.status,
      tournamentId: null,
      errors: g.status === 'check' ? [CHECK_REASON] : [],
    },
    error: category,
    attempts: g.jobs.reduce((s, j) => s + j.attempts, 0),
    users: [],
    moreUsers: 0,
    latest: newest(g.jobs),
    jobIds: g.jobs.map((j) => j.id),
    scrapedAt: null,
    fingerprint,
    checked: state === 'covered' && mark ? { by: mark.checkedBy, at: mark.checkedAt } : null,
    changed: state === 'changed',
  };
  return { row, jobs: g.jobs };
}

/** Covered jobs grouped by their stored tournament, one row each. */
function coveredRows(jobs: readonly JobRow[], refs: ReadonlyMap<string, StoredRef>) {
  const byTournament = new Map<string, { ref: StoredRef; jobs: JobRow[] }>();
  for (const j of jobs) {
    const ref = refs.get(j.id);
    if (!ref) continue;
    const g = byTournament.get(ref.id);
    if (g) g.jobs.push(j);
    else byTournament.set(ref.id, { ref, jobs: [j] });
  }
  return [...byTournament.values()].map(({ ref, jobs: js }) => {
    const row: ImportRowData = {
      key: `stored:${ref.id}`,
      section: 'covered',
      name: ref.name,
      tournamentId: ref.id,
      tabUrl: null,
      tab: { state: 'loaded', tournamentId: ref.id, errors: [] },
      error: ingestErrorCategory(js[0]?.lastError ?? ''),
      attempts: js.reduce((s, j) => s + j.attempts, 0),
      users: [],
      moreUsers: 0,
      latest: newest(js),
      jobIds: js.map((j) => j.id),
      scrapedAt: ref.scrapedAt,
      fingerprint: null,
      checked: null,
      changed: false,
    };
    return { row, jobs: js };
  });
}

type Built = { row: ImportRowData; jobs: readonly JobRow[] };

/** Most users first (more CVs affected), then the newest failure. */
const byImpact = (a: Built, b: Built) =>
  new Set(b.jobs.map((j) => j.userId)).size - new Set(a.jobs.map((j) => j.userId)).size ||
  (b.row.latest?.getTime() ?? 0) - (a.row.latest?.getTime() ?? 0) ||
  a.row.key.localeCompare(b.row.key);

/** Emails of the page's users, and for covered rows the stored tournaments' facts. */
async function enrich(page: Built[]): Promise<void> {
  const userIds = [...new Set(page.flatMap((b) => b.jobs.map((j) => j.userId)))];
  const coveredIds = page.flatMap((b) => (b.row.tournamentId ? [b.row.tournamentId] : []));
  const [users, names, tabs] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : [],
    namesOf(coveredIds),
    loadTabStates(coveredIds),
  ]);
  const email = new Map(users.map((u) => [u.id, u.email ?? 'No email'] as const));
  for (const { row, jobs } of page) {
    const ids = [...new Set(jobs.map((j) => j.userId))];
    const all = ids.map((id) => email.get(id) ?? 'Unknown user').sort();
    row.users = all.slice(0, USERS_SHOWN);
    row.moreUsers = Math.max(0, all.length - USERS_SHOWN);
    if (row.tournamentId) {
      row.tabUrl = names.get(row.tournamentId)?.tabUrl ?? null;
      row.tab = tabs.get(row.tournamentId) ?? row.tab;
    }
  }
}

export async function listImports({
  filter,
  page,
}: {
  filter: ImportsFilter;
  page: number;
}): Promise<ImportList> {
  const [unstored, stored] = await Promise.all([allImportGroups(), readFailedJobs('stored')]);
  const failing = unstored.groups.filter((g) => g.state !== 'covered').map(failingRow);
  const checked = unstored.groups.filter((g) => g.state === 'covered').map(failingRow);
  const covered = coveredRows(stored.jobs, stored.refs);
  const counts = { failing: failing.length, covered: covered.length, checked: checked.length };

  const wanted: Record<ImportsFilter, Built[][]> = {
    failing: [failing],
    covered: [covered],
    checked: [checked],
    all: [failing, checked, covered],
  };
  // "All" keeps the three groups apart (what needs you, then what you checked,
  // then what is covered), each in its own impact order.
  const all = wanted[filter].flatMap((part) => [...part].sort(byImpact));

  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / IMPORTS_PER_PAGE));
  const shown = clampPage(page, pages);
  const slice = all.slice((shown - 1) * IMPORTS_PER_PAGE, shown * IMPORTS_PER_PAGE);
  await enrich(slice);
  return {
    rows: slice.map((b) => b.row),
    total,
    page: shown,
    pages,
    filter,
    counts,
    truncated: unstored.truncated || stored.truncated,
  };
}
