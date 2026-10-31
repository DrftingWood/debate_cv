import { IngestJobStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { CHECK_LABELS, publicPieceUrl } from '@/lib/audit/types';
import { fingerprintOf, marksFor, type Mark } from '@/lib/admin/adminChecks';
import { parseChecks, suggestedPieces, type ParsedCheck } from '@/lib/admin/accuracy';
import { clampPage } from '@/lib/admin/cvReportTypes';
import { classifyWarning, isPlainProblem } from '@/lib/admin/parserClass';
import { loadWarningGroups, tournamentsOf, type WarningGroup } from '@/lib/admin/parserWarnings';
import type { Priority } from '@/lib/admin/reviewSetTypes';
import { matchJobs } from '@/lib/admin/scrapeHealth';
import { scrubComment } from '@/lib/admin/scrub';
import { parseTabAddress } from '@/lib/admin/tabAddress';
import { ambiguousTab, loadTabStates, tabState, UNMATCHABLE_TAB } from '@/lib/admin/tabStatus';
import { categoryLabel } from '@/lib/cvErrorReports/categories';
import {
  CANDIDATE_CAP,
  INBOX_KINDS,
  INBOX_PER_PAGE,
  type InboxItem,
  type InboxKind,
  type InboxList,
  type TabStatusValue,
} from '@/lib/admin/inboxTypes';
import { ingestErrorCategory } from '@/lib/ingest/userMessage';

/**
 * The Inbox (Task R2): one list of what needs the owner (owner, 2026-10-31:
 * "how am i supposed to make updates ... if i am supposed check something,
 * i should be able to mark it"). Design:
 * docs/superpowers/specs/2026-10-31-admin-redesign-design.md, "Inbox items".
 *
 * Four kinds, each read from the model that already owns it:
 *   - check: a stored audit with a fail or warn check no mark covers, one
 *     item per tournament however many checks it fails;
 *   - report: a CV report still open or acknowledged and not marked;
 *   - import: failed or abandoned jobs whose tournament is NOT stored (or
 *     cannot be told apart), one item per site address across users. Most
 *     of the ~198 failed imports on 2026-10-31 were 404s for tournaments the
 *     pre-scrape already stored: the user has the data, so they never come
 *     here (the Imports tab lists them under "Covered by stored copy");
 *   - parser: warning groups classified as problems (parserClass.ts), never
 *     the informational notes that led the old ledger.
 *
 * A properly scraped tournament is never highlighted (owner rule): every
 * item is something wrong or unconfirmed, and nothing else is read.
 *
 * Bounded reads: each kind reads at most CANDIDATE_CAP (1,000) candidates
 * (for imports, 1,000 unstored failures: stored tournaments are excluded
 * first, reading further pages as needed),
 * the item list is built, ordered and paged in memory over those, and the
 * per-kind counts are over the same bounded set. A thousand open items of
 * one kind is already a backlog no one pages through; past that the counts
 * read "1000" rather than the page slowing down. The parser groups are
 * themselves read from the bounded warnings window (parserWarnings.ts).
 *
 * A mark (adminChecks.ts) whose fingerprint still matches what the item
 * says now takes it out. One whose fingerprint differs is about data that
 * has since changed: the item stays, labelled `changedSinceChecked`.
 */

export * from '@/lib/admin/inboxTypes';

/**
 * An item before its review flag and (for parser) tournament are attached:
 * the review-set ids that would flag it, and a parser item's warning group.
 */
type Draft = Omit<InboxItem, 'reviewFlag'> & {
  flagIds: Array<{ source: string; id: string }>;
  group?: WarningGroup;
};

type MarkState = 'none' | 'covered' | 'changed';

function markState(mark: Mark | undefined, fingerprint: string): MarkState {
  if (!mark) return 'none';
  return mark.fingerprint === fingerprint ? 'covered' : 'changed';
}

// ---- check ---------------------------------------------------------------

/** A failing check outranks a warning; open user reports count as failing (accuracy.ts). */
const isFailing = (c: ParsedCheck) =>
  c.status === 'fail' || (c.code === 'user_reports' && c.status === 'warn');

type OpenCheck = { c: ParsedCheck; subject: string; fingerprint: string };
type CheckCandidate = {
  id: string;
  usersAffected: number;
  computedAt: Date;
  /** Open checks no matching mark covers, failing ones first. */
  left: OpenCheck[];
  changed: boolean;
};

/**
 * The audits with anything open, each with the checks still needing a look.
 * A check whose mark still matches is covered even before the next audit
 * turns it into a pass; the rest stay, a changed mark among them.
 */
async function checkCandidates(): Promise<CheckCandidate[]> {
  // A score below 100 is exactly an audit with a warn or fail in it (a warn
  // earns half its weight; user reports take points off), so the read skips
  // every tournament that checked out clean, including ones whose marks the
  // audit has already turned into passes. Lowest score first, so the cap
  // keeps the worst.
  const audits = await prisma.tournamentAudit.findMany({
    where: { score: { lt: 100 } },
    orderBy: [{ score: 'asc' }, { tournamentId: 'asc' }],
    take: CANDIDATE_CAP,
    select: { tournamentId: true, usersAffected: true, computedAt: true, checks: true },
  });
  const parsed = audits.map((a) => {
    const id = a.tournamentId.toString();
    const open = parseChecks(a.checks)
      .filter((c) => c.status === 'fail' || c.status === 'warn')
      // The first failing finding leads; with none failing, the first warning.
      .sort((x, y) => Number(isFailing(y)) - Number(isFailing(x)))
      .map((c) => ({
        c,
        subject: `${id}:${c.code}`,
        fingerprint: fingerprintOf('check', { status: c.status, detail: c.detail }),
      }));
    return { a, id, open };
  });
  const marks = await marksFor(
    'check',
    parsed.flatMap((p) => p.open.map((o) => o.subject)),
  );
  const out: CheckCandidate[] = [];
  for (const { a, id, open } of parsed) {
    const states = open.map((o) => markState(marks.get(o.subject), o.fingerprint));
    const left = open.filter((_, i) => states[i] !== 'covered');
    if (left.length === 0) continue;
    out.push({
      id,
      usersAffected: a.usersAffected,
      computedAt: a.computedAt,
      left,
      changed: states.includes('changed'),
    });
  }
  return out;
}

async function checkDrafts(): Promise<Draft[]> {
  const kept = await checkCandidates();
  const ids = kept.map((p) => p.id);
  const [names, tabs] = await Promise.all([namesOf(ids), loadTabStates(ids)]);
  return kept.flatMap(({ id, usersAffected, computedAt, left, changed }): Draft[] => {
    // Never empty: checkCandidates drops a tournament with nothing left.
    const lead = left[0];
    const named = names.get(id);
    return [
      {
        key: `check:${id}`,
        kind: 'check',
        tournament: {
          id,
          name: named?.name ?? `Tournament ${id}`,
          tabUrl: named?.tabUrl ?? null,
          status: (tabs.get(id) ?? tabState(id, [])).state,
        },
        summary: lead.c.detail || CHECK_LABELS[lead.c.code],
        more: left.length - 1,
        usersAffected,
        severity: isFailing(lead.c) ? 'fail' : 'warn',
        // When it was last audited: the audit is where the finding comes from.
        age: computedAt,
        fix: { type: 'rescrape', tournamentId: id, pieces: suggestedPieces(left.map((o) => o.c)) },
        markItems: left.map((o) => ({
          kind: 'check',
          subject: o.subject,
          fingerprint: o.fingerprint,
        })),
        changedSinceChecked: changed,
        // Review-set flags have no check source; a check carries none.
        flagIds: [],
      },
    ];
  });
}

/** Stored names and public tab addresses, one query; a private key never leaves here. */
async function namesOf(ids: string[]) {
  const unique = [...new Set(ids)].filter((id) => /^\d{1,18}$/.test(id));
  if (unique.length === 0) return new Map<string, { name: string; tabUrl: string | null }>();
  const rows = await prisma.tournament.findMany({
    where: { id: { in: unique.map((id) => BigInt(id)) } },
    select: { id: true, name: true, sourceUrlRaw: true },
  });
  return new Map(
    rows.map((t) => [t.id.toString(), { name: t.name, tabUrl: publicPieceUrl(t.sourceUrlRaw) }]),
  );
}

// ---- report --------------------------------------------------------------

const OPEN_REPORT = ['open', 'acknowledged'] as const;
const SUMMARY_CHARS = 160;
const clip = (s: string) =>
  s.length > SUMMARY_CHARS ? `${s.slice(0, SUMMARY_CHARS - 1).trimEnd()}…` : s;

async function reportDrafts(): Promise<Draft[]> {
  // Oldest first, so the cap keeps the reports that have waited longest.
  const reports = await prisma.cvErrorReport.findMany({
    where: { status: { in: [...OPEN_REPORT] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: CANDIDATE_CAP,
    select: {
      id: true,
      status: true,
      tournamentIds: true,
      categories: true,
      comment: true,
      createdAt: true,
    },
  });
  const marks = await marksFor(
    'report',
    reports.map((r) => r.id),
  );
  const open = reports
    .map((r) => {
      const fingerprint = fingerprintOf('report', { status: r.status });
      return { r, fingerprint, state: markState(marks.get(r.id), fingerprint) };
    })
    .filter((x) => x.state !== 'covered');
  const firstIds = open.map(({ r }) => r.tournamentIds.find((id) => /^\d{1,18}$/.test(id)));
  const ids = firstIds.filter((id): id is string => !!id);
  const [names, tabs] = await Promise.all([namesOf(ids), loadTabStates(ids)]);
  return open.map(({ r, fingerprint, state }, i): Draft => {
    // The report's first stored tournament stands for it, as in the review set.
    const tid = firstIds[i];
    const named = tid ? names.get(tid) : undefined;
    const categories = r.categories.map(categoryLabel).join(', ');
    return {
      key: `report:${r.id}`,
      kind: 'report',
      tournament:
        tid && named
          ? {
              id: tid,
              name: named.name,
              tabUrl: named.tabUrl,
              status: (tabs.get(tid) ?? tabState(tid, [])).state,
            }
          : null,
      // The user's own words can carry a private URL: scrubbed first.
      summary: clip(categories || scrubComment(r.comment).trim() || 'CV error report'),
      more: 0,
      // The reporter: the one user known to have the error on their CV.
      usersAffected: 1,
      // Nobody has looked at an open report yet; an acknowledged one is in hand.
      severity: r.status === 'open' ? 'fail' : 'warn',
      age: r.createdAt,
      fix: { type: 'open', href: `/admin?tab=reports&reportsStatus=${r.status}#report-${r.id}` },
      markItems: [{ kind: 'report', subject: r.id, fingerprint }],
      changedSinceChecked: state === 'changed',
      flagIds: [{ source: 'cv_report', id: r.id }],
    };
  });
}

// ---- import --------------------------------------------------------------

type JobRow = {
  id: string;
  userId: string;
  url: string;
  attempts: number;
  lastError: string | null;
  finishedAt: Date | null;
  scheduledAt: Date;
};

const MAX_JOB_PAGES = 10;

/**
 * Failed or abandoned jobs whose tournament is not stored, newest first,
 * bounded at CANDIDATE_CAP unstored jobs. Stored tournaments are excluded
 * before the cap counts, so a large "covered by stored copy" backlog cannot
 * push unstored failures out of the window: the newest jobs are read a page
 * at a time and matched, until CANDIDATE_CAP unstored jobs are held or the
 * jobs run out. The scan itself is bounded at MAX_JOB_PAGES pages
 * (MAX_JOB_PAGES x CANDIDATE_CAP rows): past that ceiling it stops and the
 * result is truncated, so a huge stored-copy backlog cannot make every
 * Inbox load walk the whole table.
 */
async function readUnstoredJobs(): Promise<{
  jobs: JobRow[];
  ambiguous: Map<string, number>;
}> {
  const jobs: JobRow[] = [];
  const ambiguous = new Map<string, number>();
  for (let pageNo = 0; pageNo < MAX_JOB_PAGES && jobs.length < CANDIDATE_CAP; pageNo++) {
    const skip = pageNo * CANDIDATE_CAP;
    const page: JobRow[] = await prisma.ingestJob.findMany({
      where: { status: { in: [IngestJobStatus.failed, IngestJobStatus.abandoned] } },
      orderBy: [{ finishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      skip,
      take: CANDIDATE_CAP,
      select: {
        id: true,
        userId: true,
        url: true,
        attempts: true,
        lastError: true,
        finishedAt: true,
        scheduledAt: true,
      },
    });
    const match = await matchJobs(page);
    for (const j of page) {
      if (match.stored.has(j.id) || jobs.length >= CANDIDATE_CAP) continue;
      jobs.push(j);
      const n = match.ambiguous.get(j.id);
      if (n) ambiguous.set(j.id, n);
    }
    if (page.length < CANDIDATE_CAP) break;
  }
  return { jobs, ambiguous };
}

type JobGroup = { jobs: JobRow[]; status: TabStatusValue; tabUrl: string | null; name: string };

/**
 * The jobs whose tournament is not stored, one group per tournament across
 * users: its site address. A URL that names no tournament (no slug, or not
 * a tab site) stands alone under its job id. A stored tournament's failed
 * import is covered by the stored copy (the user has the data), so it is
 * left out here and so from every inbox count.
 */
function groupUnstored(
  jobs: JobRow[],
  match: { stored: ReadonlyMap<string, unknown>; ambiguous: ReadonlyMap<string, number> },
): Map<string, JobGroup> {
  const groups = new Map<string, JobGroup>();
  for (const j of jobs) {
    if (match.stored.has(j.id)) continue;
    const a = parseTabAddress(j.url);
    const subject = a?.slug ? `${a.host}/${a.slug}`.toLowerCase() : j.id;
    const n = match.ambiguous.get(j.id);
    let status: TabStatusValue = 'missing';
    if (n) status = ambiguousTab(n).state;
    else if (a && !a.slug) status = UNMATCHABLE_TAB.state;
    const g = groups.get(subject);
    if (g) {
      g.jobs.push(j);
      if (status === 'check') g.status = 'check';
      continue;
    }
    let name = 'Unrecognised address';
    if (a) name = a.slug ? `${a.host}/${a.slug}` : a.host;
    groups.set(subject, { jobs: [j], status, tabUrl: a?.publicUrl ?? null, name });
  }
  return groups;
}

/**
 * The newest job's error in words, and every attempt so far: another
 * failure (a retry, another user's job) changes it, so a mark lapses.
 */
function importPrint(g: JobGroup): { category: string; fingerprint: string } {
  const category = ingestErrorCategory(g.jobs[0]?.lastError ?? '');
  const attempts = g.jobs.reduce((s, j) => s + j.attempts, 0);
  return { category, fingerprint: fingerprintOf('import', { errorCategory: category, attempts }) };
}

async function importDrafts(): Promise<Draft[]> {
  const { jobs, ambiguous } = await readUnstoredJobs();
  const groups = groupUnstored(jobs, { stored: new Map(), ambiguous });
  const marks = await marksFor('import', [...groups.keys()]);
  const out: Draft[] = [];
  for (const [subject, g] of groups) {
    const { category, fingerprint } = importPrint(g);
    const state = markState(marks.get(subject), fingerprint);
    if (state === 'covered') continue;
    const ages = g.jobs.map((j) => (j.finishedAt ?? j.scheduledAt).getTime());
    out.push({
      key: `import:${subject}`,
      kind: 'import',
      tournament: { id: null, name: g.name, tabUrl: g.tabUrl, status: g.status },
      summary: category,
      more: 0,
      usersAffected: new Set(g.jobs.map((j) => j.userId)).size,
      severity: 'fail',
      age: new Date(Math.min(...ages)),
      fix: { type: 'retry', jobIds: g.jobs.map((j) => j.id) },
      markItems: [{ kind: 'import', subject, fingerprint }],
      changedSinceChecked: state === 'changed',
      flagIds: g.jobs.map((j) => ({ source: 'import', id: j.id })),
    });
  }
  return out;
}

// ---- parser --------------------------------------------------------------

async function parserDrafts(now: Date): Promise<Draft[]> {
  const problems = (await loadWarningGroups(now))
    .filter((g) => classifyWarning(g.headline) === 'problem')
    .slice(0, CANDIDATE_CAP);
  const marks = await marksFor(
    'parser',
    problems.map((g) => g.key),
  );
  const out: Draft[] = [];
  for (const g of problems) {
    const fingerprint = fingerprintOf('parser', { count: g.count });
    const state = markState(marks.get(g.key), fingerprint);
    if (state === 'covered') continue;
    out.push({
      key: `parser:${g.key}`,
      kind: 'parser',
      // Attached for the page's rows only (withParserTournaments).
      tournament: null,
      summary: `${g.headline} (${g.count} ${g.count === 1 ? 'time' : 'times'})`,
      more: 0,
      // A warning is about pages, not anyone's CV directly.
      usersAffected: 0,
      severity: isPlainProblem(g.headline) ? 'fail' : 'warn',
      age: g.latestAt,
      fix: { type: 'open', href: '/admin?tab=parser' },
      markItems: [{ kind: 'parser', subject: g.key, fingerprint }],
      changedSinceChecked: state === 'changed',
      flagIds: [{ source: 'parser_warning', id: g.key }],
      group: g,
    });
  }
  return out;
}

/**
 * A parser item names its tournament when its runs read exactly one; one
 * spanning several names none (the Parser tab lists them). Looked up for the
 * page's parser rows only, so the cost does not grow with the list.
 */
async function withParserTournaments(rows: Draft[]) {
  const parser = rows.flatMap((r) => (r.group ? [{ r, group: r.group }] : []));
  if (parser.length === 0) return;
  const lists = await tournamentsOf(parser.map((p) => p.group));
  parser.forEach(({ r }, i) => {
    const list = lists[i] ?? [];
    const only = list.length === 1 ? list[0] : undefined;
    if (only) {
      r.tournament = { id: only.id, name: only.name, tabUrl: only.tabUrl, status: only.tab.state };
      if (only.id) r.fix = { type: 'open', href: `/admin/tournaments/${only.id}` };
    }
  });
}

// ---- the list ------------------------------------------------------------

/**
 * Users affected first (more CVs wrong is worse), then a fail before a
 * warn, then the oldest. Array.prototype.sort is stable, so items tied on
 * all three keep their source's order (worst score, busiest warning).
 */
function byImpact(a: Draft, b: Draft): number {
  return (
    b.usersAffected - a.usersAffected ||
    (a.severity === b.severity ? 0 : a.severity === 'fail' ? -1 : 1) ||
    a.age.getTime() - b.age.getTime()
  );
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const isPriority = (p: string): p is Priority => Object.hasOwn(PRIORITY_RANK, p);

/** Open review-set flags by `<source>|<sourceId>`, the highest priority kept. */
async function openFlags(): Promise<Map<string, Priority>> {
  const flags = await prisma.reviewFlag.findMany({
    where: { status: 'open' },
    select: { source: true, sourceId: true, priority: true },
  });
  const out = new Map<string, Priority>();
  for (const f of flags) {
    if (!isPriority(f.priority)) continue;
    const k = `${f.source}|${f.sourceId}`;
    const had = out.get(k);
    if (!had || PRIORITY_RANK[f.priority] < PRIORITY_RANK[had]) out.set(k, f.priority);
  }
  return out;
}

export async function listInbox({
  page,
  kinds,
  now = new Date(),
}: {
  page: number;
  kinds?: InboxKind[];
  now?: Date;
}): Promise<InboxList> {
  const [checks, reports, imports, parsers, flags] = await Promise.all([
    checkDrafts(),
    reportDrafts(),
    importDrafts(),
    parserDrafts(now),
    openFlags(),
  ]);
  const counts: Record<InboxKind, number> = {
    check: checks.length,
    report: reports.length,
    import: imports.length,
    parser: parsers.length,
  };
  const wanted = new Set<InboxKind>(kinds && kinds.length > 0 ? kinds : INBOX_KINDS);
  const all = [...checks, ...reports, ...imports, ...parsers]
    .filter((d) => wanted.has(d.kind))
    .sort(byImpact);

  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / INBOX_PER_PAGE));
  const shown = clampPage(page, pages);
  const slice = all.slice((shown - 1) * INBOX_PER_PAGE, shown * INBOX_PER_PAGE);
  await withParserTournaments(slice);

  const rows = slice.map(({ flagIds, group: _group, ...item }): InboxItem => {
    let priority: Priority | undefined;
    for (const f of flagIds) {
      const p = flags.get(`${f.source}|${f.id}`);
      if (p && (!priority || PRIORITY_RANK[p] < PRIORITY_RANK[priority])) priority = p;
    }
    return { ...item, reviewFlag: priority ? { priority } : null };
  });
  return { rows, total, page: shown, pages, counts };
}
