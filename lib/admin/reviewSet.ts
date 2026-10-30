import { prisma } from '@/lib/db';
import { publicPieceUrl } from '@/lib/audit/types';
import { storedForJobs } from '@/lib/admin/scrapeHealth';
import { loadTabStates, tabState, type TabState } from '@/lib/admin/tabStatus';
import { ingestErrorCategory } from '@/lib/ingest/userMessage';
import { csvLine } from '@/lib/utils/csv';
import { scrubComment } from '@/lib/admin/scrub';
import {
  detailText,
  itemKey,
  loadFlagDetails,
  resolveCvReportItems,
  type FlagDetail,
} from '@/lib/admin/reviewSetSources';
import {
  sortFlags,
  type FlagItem,
  type FlagSource,
  type FlagStatus,
  type Priority,
} from '@/lib/admin/reviewSetTypes';

export * from '@/lib/admin/reviewSetTypes';
export type { FlagDetail } from '@/lib/admin/reviewSetSources';

/**
 * The review set (owner, 2026-10-31: "prioritize some errors and bring to a
 * separate set that you can later pick for review - prioritize and add a
 * comment"). An admin ticks failed imports, gives them a priority and a
 * comment, and a later session reads the export to know what to look at
 * first. One set for every kind of problem (Ruling 16): failed imports
 * today; CV reports and parser warnings join it in Task 5d, which is why a
 * flag names its item by `source` + `sourceId` and resolves only what it can
 * for a source it does not know yet.
 *
 * Nothing private is stored or handed on. A flag's `url` is the public tab
 * address, made public when written and again when read (a row written by
 * hand must not leak either), and a comment has any pasted private URL
 * reduced to its public form, because the comment goes into the export.
 */

/** The most flags read at once: far more than a person triages, and a bound on the export. */
const READ_CAP = 1000;

export { scrubComment };

/** What a new flag records about its item: its public address and stored tournament. */
type Resolved = { url: string; tournamentId: bigint | null };

/**
 * Import flags take their job's public tab address and stored tournament;
 * CV report flags take their report's first stored tournament
 * (reviewSetSources.ts). An id that no longer names a job or a report is
 * dropped: there would be nothing to review. Parser warnings are kept as
 * they are, with no address or tournament: a warning spans many.
 */
async function resolveItems(items: FlagItem[]): Promise<Map<string, Resolved>> {
  const key = itemKey;
  const out = new Map<string, Resolved>();
  const importIds = items.filter((i) => i.source === 'import').map((i) => i.sourceId);
  if (importIds.length > 0) {
    const jobs = await prisma.ingestJob.findMany({
      where: { id: { in: importIds } },
      select: { id: true, url: true, userId: true },
    });
    const stored = await storedForJobs(jobs);
    for (const j of jobs) {
      const ref = stored.get(j.id);
      out.set(key({ source: 'import', sourceId: j.id }), {
        url: publicPieceUrl(j.url) ?? '',
        tournamentId: ref ? BigInt(ref.id) : null,
      });
    }
  }
  const reports = await resolveCvReportItems(
    items.filter((i) => i.source === 'cv_report').map((i) => i.sourceId),
  );
  for (const [id, r] of reports) out.set(key({ source: 'cv_report', sourceId: id }), r);
  for (const i of items) {
    if (i.source === 'parser_warning') out.set(key(i), { url: '', tournamentId: null });
  }
  return out;
}

/**
 * Adds items to the set, or refreshes them: an item with an open flag gets
 * the new priority and comment rather than a second flag. Both writes run in
 * one transaction with the read that decides between them.
 */
export async function addToReviewSet(input: {
  items: FlagItem[];
  priority: Priority;
  comment: string;
  createdBy: string;
}): Promise<{ flagged: number }> {
  const key = (i: FlagItem) => `${i.source}\u0000${i.sourceId}`;
  const unique = [...new Map(input.items.map((i) => [key(i), i] as const)).values()];
  const resolved = await resolveItems(unique);
  const items = unique.filter((i) => resolved.has(key(i)));
  if (items.length === 0) return { flagged: 0 };
  const comment = scrubComment(input.comment);

  const bySource = new Map<FlagSource, string[]>();
  for (const i of items) bySource.set(i.source, [...(bySource.get(i.source) ?? []), i.sourceId]);

  return prisma.$transaction(async (tx) => {
    const open = await tx.reviewFlag.findMany({
      where: {
        status: 'open',
        OR: [...bySource].map(([source, ids]) => ({ source, sourceId: { in: ids } })),
      },
      select: { id: true, source: true, sourceId: true },
    });
    const openKeys = new Set(open.map((f) => key(f as FlagItem)));
    const updated = open.length
      ? (
          await tx.reviewFlag.updateMany({
            where: { id: { in: open.map((f) => f.id) } },
            data: { priority: input.priority, comment },
          })
        ).count
      : 0;
    const fresh = items.filter((i) => !openKeys.has(key(i)));
    const created = fresh.length
      ? (
          await tx.reviewFlag.createMany({
            data: fresh.map((i) => ({
              source: i.source,
              sourceId: i.sourceId,
              ...resolved.get(key(i))!,
              priority: input.priority,
              comment,
              createdBy: input.createdBy,
            })),
          })
        ).count
      : 0;
    return { flagged: updated + created };
  });
}

export type UpdateResult = 'ok' | 'not_found' | 'already_open';

/**
 * Edits one flag. Reopening a done flag is refused while its item has
 * another open one, so the one-open-flag rule holds both ways.
 */
export async function updateFlag(input: {
  id: bigint;
  priority?: Priority;
  comment?: string;
  status?: FlagStatus;
}): Promise<UpdateResult> {
  const current = await prisma.reviewFlag.findUnique({
    where: { id: input.id },
    select: { id: true, source: true, sourceId: true, status: true },
  });
  if (!current) return 'not_found';
  if (input.status === 'open' && current.status !== 'open') {
    const other = await prisma.reviewFlag.findFirst({
      where: {
        source: current.source,
        sourceId: current.sourceId,
        status: 'open',
        id: { not: current.id },
      },
      select: { id: true },
    });
    if (other) return 'already_open';
  }
  const data: { priority?: Priority; comment?: string; status?: FlagStatus } = {};
  if (input.priority) data.priority = input.priority;
  if (input.comment !== undefined) data.comment = scrubComment(input.comment);
  if (input.status) data.status = input.status;
  await prisma.reviewFlag.update({ where: { id: input.id }, data });
  return 'ok';
}

/** A flag as the page and the export show it: public address, error in words, live Tab state. */
export type ReviewFlagView = {
  id: string;
  source: FlagSource;
  sourceId: string;
  priority: Priority;
  comment: string;
  status: FlagStatus;
  /** The public tab address, or null when there is none. */
  url: string | null;
  tournament: { id: string; name: string } | null;
  /** An import's last error in words (never the raw exception); null otherwise. */
  lastError: string | null;
  /** An import's attempts; null for other sources or a job that is gone. */
  attempts: number | null;
  tab: TabState;
  /** What a CV report or parser warning flag is about (Task 5d); null for imports. */
  detail: FlagDetail | null;
  createdBy: string;
  createdAt: Date;
};

/**
 * The set as stored, high to low. An import flag also reads its job again:
 * its current error and attempts, and its stored tournament, so a tab that
 * was imported after it was flagged shows as loaded.
 */
export async function loadReviewSet(
  opts: { status?: 'open' | 'all'; order?: 'oldest' | 'newest' } = {},
): Promise<ReviewFlagView[]> {
  const rows = await prisma.reviewFlag.findMany({
    where: opts.status === 'all' ? {} : { status: 'open' },
    orderBy: { createdAt: 'desc' },
    take: READ_CAP,
    include: { tournament: { select: { id: true, name: true } } },
  });
  if (rows.length === 0) return [];

  const importIds = [...new Set(rows.filter((r) => r.source === 'import').map((r) => r.sourceId))];
  const jobs = importIds.length
    ? await prisma.ingestJob.findMany({
        where: { id: { in: importIds } },
        select: { id: true, url: true, userId: true, attempts: true, lastError: true },
      })
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j] as const));
  const storedByJob = await storedForJobs(jobs);

  const tournamentOf = (r: (typeof rows)[number]) => {
    const live = r.source === 'import' ? storedByJob.get(r.sourceId) : undefined;
    if (live) return { id: live.id, name: live.name };
    return r.tournament ? { id: r.tournament.id.toString(), name: r.tournament.name } : null;
  };
  const [tabs, details] = await Promise.all([
    loadTabStates(rows.map((r) => tournamentOf(r)?.id).filter((id): id is string => !!id)),
    loadFlagDetails(
      rows.map((r) => ({ source: r.source as FlagSource, sourceId: r.sourceId })),
      new Date(),
    ),
  ]);

  const views = rows.map((r): ReviewFlagView => {
    const job = r.source === 'import' ? jobById.get(r.sourceId) : undefined;
    const tournament = tournamentOf(r);
    return {
      id: r.id.toString(),
      source: r.source as FlagSource,
      sourceId: r.sourceId,
      priority: r.priority as Priority,
      comment: scrubComment(r.comment),
      status: r.status as FlagStatus,
      url: (r.url && publicPieceUrl(r.url)) || null,
      tournament,
      lastError: job?.lastError ? ingestErrorCategory(job.lastError) : null,
      attempts: job ? job.attempts : null,
      tab: (tournament && tabs.get(tournament.id)) || tabState(null, []),
      detail:
        details.get(itemKey({ source: r.source as FlagSource, sourceId: r.sourceId })) ?? null,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    };
  });
  return sortFlags(views, opts.order ?? 'newest');
}

/** One flag as the JSON export writes it: what a later session reads. */
export function toExportRecord(f: ReviewFlagView) {
  return {
    id: f.id,
    source: f.source,
    sourceId: f.sourceId,
    priority: f.priority,
    status: f.status,
    comment: f.comment,
    url: f.url,
    tournamentId: f.tournament?.id ?? null,
    tournamentName: f.tournament?.name ?? null,
    lastError: f.lastError,
    attempts: f.attempts,
    tab: f.tab.state,
    tabErrors: f.tab.errors,
    detail: f.detail,
    createdBy: f.createdBy,
    createdAt: f.createdAt.toISOString(),
  };
}

const CSV_HEADER = [
  'id',
  'source',
  'source_id',
  'priority',
  'status',
  'comment',
  'url',
  'tournament_id',
  'tournament_name',
  'last_error',
  'attempts',
  'tab',
  'tab_errors',
  'created_by',
  'created_at',
  'detail',
];

/** The same records as CSV, one row per flag under a header row (csvCell quotes as needed). */
export function reviewSetCsv(flags: readonly ReviewFlagView[]): string {
  return [
    csvLine(CSV_HEADER),
    ...flags.map((f) => {
      const r = toExportRecord(f);
      return csvLine([
        r.id,
        r.source,
        r.sourceId,
        r.priority,
        r.status,
        r.comment,
        r.url,
        r.tournamentId,
        r.tournamentName,
        r.lastError,
        r.attempts,
        r.tab,
        r.tabErrors.join('; '),
        r.createdBy,
        r.createdAt,
        detailText(f.detail),
      ]);
    }),
  ].join('\n');
}
