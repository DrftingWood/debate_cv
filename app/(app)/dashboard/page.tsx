import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowSquareOut, Prohibit, Tray, Warning } from '@/components/ui/icons';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isAdminEmail } from '@/lib/admin';
import { isDiscoveryEnabled } from '@/lib/discovery/flag';
import { fullScanAvailableAt } from '@/lib/gmail/fullScan';
import {
  ScanButton,
  FullScanButton,
  UploadCsvButton,
  IngestAllButton,
  IngestButton,
  ClearButton,
  LockUrlButton,
} from '@/components/DashboardActions';
import { RetryFailedButton } from '@/components/RetryFailedButton';
import { UnmatchedRowExpand } from '@/components/UnmatchedRowExpand';
import { GmailDisconnectedNotice } from '@/components/GmailDisconnectedNotice';
import { ReconnectGmailButton } from '@/components/ReconnectGmailButton';
import { IngestProgressTracker } from '@/components/IngestProgressTracker';
import { ImportsStages } from '@/components/ImportsStages';
import { ImportsReview } from '@/components/ImportsReview';
import { Card, CardBody } from '@/components/ui/Card';
import { buttonClasses } from '@/components/ui/Button';
import { StatusPill, type Status as PillStatus } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Th, Td, Tr } from '@/components/ui/DataTable';
import { cn } from '@/lib/utils/cn';
import { ingestErrorCategory } from '@/lib/ingest/userMessage';
import {
  countByFilter,
  matchesFilter,
  resolvePage,
  statusFor,
  type ImportFilterKey,
} from '@/lib/ingest/importRows';

export const metadata: Metadata = {
  title: 'Imports',
  description: 'Scan Gmail, ingest Tabbycat private URLs, and track progress.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type FilterKey = ImportFilterKey;

const FILTER_KEYS: FilterKey[] = ['all', 'pending', 'failed', 'unmatched', 'unavailable', 'done'];

function isFilterKey(value: string | undefined): value is FilterKey {
  return !!value && (FILTER_KEYS as string[]).includes(value);
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; stage?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;
  // Only an admin may force a re-scrape (assumptions I53); see /api/ingest/url.
  const canForce = isAdminEmail(session.user.email);

  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: userId },
  });
  if (claimedCount === 0) redirect('/onboarding');

  const params = await searchParams;
  // Two-level page: the bare /dashboard is a calm summary (tracker + tiles
  // + the two actions); the detailed URL table only renders once the user
  // opts in via a tile or the browse link (?filter=...). The table is the
  // single biggest source of "this feels like an engineering panel" — most
  // visits just want "did anything new arrive, is it processing".
  // The Review stage is a third view (`?stage=review`, owner decision
  // 2026-10-29): name claims and, with the discovery flag, the Found list
  // that used to be /cv/found (which now redirects here).
  const reviewing = params.stage === 'review';
  const browsing = !reviewing && isFilterKey(params.filter);
  const activeFilter: FilterKey = isFilterKey(params.filter) ? params.filter : 'all';

  // Every URL and job is loaded, uncapped, as a light row: the tile counts
  // and the filter must describe the whole set (NV-12; the old `take: 200`
  // made a heavy user's counts silently wrong). Only the page of rows that
  // is rendered gets the heavy tournament join, below.
  const [gmailToken, urls, jobs, claimedTournamentIds, fullScanAt] = await Promise.all([
    prisma.gmailToken.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.discoveredUrl.findMany({
      where: { userId },
      orderBy: { messageDate: 'desc' },
      select: { id: true, url: true, ingestedAt: true, tournamentId: true },
    }),
    prisma.ingestJob.findMany({
      where: { userId },
      orderBy: { scheduledAt: 'desc' },
      select: { url: true, status: true, lastError: true },
    }),
    prisma.tournamentParticipant
      .findMany({
        where: { person: { claimedByUserId: userId } },
        select: { tournamentId: true },
        distinct: ['tournamentId'],
      })
      .then((rows) => new Set(rows.map((r) => r.tournamentId.toString()))),
    fullScanAvailableAt(userId),
  ]);

  const jobByUrl = new Map(jobs.map((j) => [j.url, j] as const));

  // Compute status per URL once. `unmatched` supersedes `done` when the URL
  // ingested but the user has no TournamentParticipant in the resulting
  // tournament — they need to claim themselves manually via the inline
  // search expander below.
  const allRows = urls.map((u) => {
    const job = jobByUrl.get(u.url);
    const baseStatus = statusFor(!!u.ingestedAt, job?.status, job?.lastError);
    const tournamentIdStr = u.tournamentId?.toString();
    const isUnmatched =
      baseStatus === 'done' && !!tournamentIdStr && !claimedTournamentIds.has(tournamentIdStr);
    const status: PillStatus = isUnmatched ? 'unmatched' : baseStatus;
    return { u, job, status };
  });

  const counts = countByFilter(allRows.map((r) => r.status));
  const rows = allRows;

  const filtered = allRows.filter((r) => matchesFilter(r.status, activeFilter));

  // IMPORT_PAGE_SIZE (20) rows per page, with the page in the URL (UX-81). Only these rows get
  // the tournament join.
  const pageInfo = resolvePage(params.page, filtered.length);
  const pageIds = filtered.slice(pageInfo.start, pageInfo.end).map((r) => r.u.id);
  const pageTournaments = pageIds.length
    ? await prisma.discoveredUrl.findMany({
        where: { id: { in: pageIds }, userId },
        select: {
          id: true,
          reingestLocked: true,
          messageDate: true,
          // Never load sourceUrlRaw here: it is the first ingester's private URL.
          tournament: { omit: { sourceUrlRaw: true } },
        },
      })
    : [];
  const detailById = new Map(pageTournaments.map((d) => [d.id, d] as const));
  const pageRows = filtered.slice(pageInfo.start, pageInfo.end).flatMap(({ u, job, status }) => {
    const d = detailById.get(u.id);
    return d ? [{ u: { ...u, ...d }, job, status }] : [];
  });
  const pageHref = (n: number) => `/dashboard?filter=${activeFilter}${n > 1 ? `&page=${n}` : ''}`;

  // With Gmail disconnected the Scan button is disabled, so the empty state
  // must not tell the user to click it. It carries the action itself (NV-26).
  const emptyDescription = gmailToken
    ? "Scan Gmail to find Tabbycat private URLs in your inbox. We'll auto-ingest them in the same click."
    : 'Reconnect Gmail above, or upload a CSV of private URLs.';
  const emptyAction = gmailToken ? <ScanButton /> : <UploadCsvButton />;

  return (
    <div className="space-y-10">
      {/* Page masthead. No AutoScanOnVisit here — the background scan fires
          on /cv only; this page is where scans are triggered deliberately. */}
      <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="data-label">Imports · from Gmail to your record</div>
          <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
            {/* "In flight" only while something is: in the steady state the
                page is simply the list of imports. */}
            {counts.pending > 0
              ? `Importing ${counts.pending} ${counts.pending === 1 ? 'tournament' : 'tournaments'}`
              : 'Imports'}
          </h1>
          <p className="mt-1.5 text-table text-ink-soft">
            Scanning finds the private URLs; ingesting turns each one into rows on your record.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.pending > 0 ? <IngestAllButton pendingCount={counts.pending} /> : null}
          <UploadCsvButton />
          <FullScanButton
            disconnected={!gmailToken}
            availableAt={fullScanAt?.toISOString() ?? null}
          />
          <ScanButton disconnected={!gmailToken} />
        </div>
      </header>

      <IngestProgressTracker scope="user" />

      {!gmailToken ? (
        <GmailDisconnectedNotice
          action={<ReconnectGmailButton redirectTo="/dashboard" variant="primary" />}
        >
          Your Google grant was removed. Reconnect to keep scanning your inbox for tournament URLs.
        </GmailDisconnectedNotice>
      ) : null}

      <ImportsStages
        counts={counts}
        view={reviewing ? 'review' : browsing ? activeFilter : null}
        discovery={isDiscoveryEnabled(session.user.email)}
      />

      {reviewing ? (
        <ImportsReview userId={userId} email={session.user.email} unmatched={counts.unmatched} />
      ) : !browsing ? (
        /* Summary view: the tiles above carry the counts; the table is one
           click away. Most visits end here. */
        rows.length === 0 ? (
          <EmptyState
            icon={<Tray weight="light" className="h-5 w-5" aria-hidden />}
            title="No private URLs yet"
            description={emptyDescription}
            action={emptyAction}
          />
        ) : (
          <p data-print-hide="true">
            <Link
              href="/dashboard?filter=all"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-ui text-ink underline underline-offset-4 hover:text-primary"
            >
              Browse all {counts.all} URLs
              <span aria-hidden>→</span>
            </Link>
          </p>
        )
      ) : (
        <section className="space-y-4">
          <header className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="font-display text-h4 font-medium text-ink">Private URLs</h2>
                <p className="mt-0.5 text-caption text-ink-soft">
                  {filtered.length === counts.all
                    ? `${counts.all} total · most recent first`
                    : `${filtered.length} of ${counts.all} · ${activeFilter}`}
                  {pageInfo.pages > 1
                    ? ` · showing ${pageInfo.start + 1}–${pageInfo.end} of ${filtered.length}`
                    : ''}
                </p>
              </div>
              <Link
                href="/dashboard"
                className="inline-flex min-h-6 items-center text-caption text-ink-soft underline underline-offset-2 hover:text-ink"
              >
                ← Summary
              </Link>
            </div>

            {/* Filter chips + contextual bulk action. The Ingest-all button
              deliberately does NOT repeat here — it lives once, in the
              masthead, whenever anything is pending. */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip activeFilter={activeFilter} filter="all" label={`All (${counts.all})`} />
              <FilterChip
                activeFilter={activeFilter}
                filter="pending"
                label={`Pending (${counts.pending})`}
              />
              <FilterChip
                activeFilter={activeFilter}
                filter="failed"
                label={`Failed (${counts.failed})`}
              />
              <FilterChip
                activeFilter={activeFilter}
                filter="unmatched"
                label={`Unmatched (${counts.unmatched})`}
              />
              <FilterChip
                activeFilter={activeFilter}
                filter="done"
                label={`Done (${counts.done})`}
              />
              {counts.unavailable > 0 ? (
                <FilterChip
                  activeFilter={activeFilter}
                  filter="unavailable"
                  label={`Unavailable (${counts.unavailable})`}
                />
              ) : null}
              <span className="ml-auto" />
              {activeFilter === 'failed' && counts.failed > 0 ? (
                <RetryFailedButton count={counts.failed} />
              ) : null}
            </div>
          </header>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Tray weight="light" className="h-5 w-5" aria-hidden />}
              title="No private URLs yet"
              description={emptyDescription}
              action={emptyAction}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Prohibit weight="light" className="h-5 w-5" aria-hidden />}
              title={`No ${activeFilter} URLs`}
              description="Nothing matches this filter right now."
              action={
                <Link
                  href="/dashboard?filter=all"
                  scroll={false}
                  className={buttonClasses({ variant: 'outline' })}
                >
                  Show all URLs
                </Link>
              }
            />
          ) : (
            <>
              {/* Mobile cards */}
              <ul className="space-y-2 md:hidden">
                {pageRows.map(({ u, job, status }) => (
                  <li key={u.id}>
                    <Card>
                      <CardBody className="space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 wrap-break-word text-body font-semibold text-ink">
                              {u.tournament?.name ?? '—'}
                            </div>
                            <TournamentMetrics
                              tournament={u.tournament}
                              ingestedAt={u.ingestedAt}
                            />
                            <a
                              href={u.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 flex min-h-6 items-center gap-1 truncate font-mono text-byline text-ink-soft transition-colors hover:text-primary"
                            >
                              {u.url}
                              <span className="sr-only">(opens in a new tab)</span>
                              <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="sr-only"> (opens in new tab)</span>
                            </a>
                          </div>
                          <StatusPill status={status} />
                        </div>
                        <div className="flex items-center justify-between text-caption text-ink-soft">
                          <span>{u.messageDate ? formatDate(u.messageDate) : '—'}</span>
                          <RowActions
                            url={u.url}
                            tournamentId={u.tournament?.id.toString() ?? null}
                            tournamentName={u.tournament?.name ?? null}
                            status={status}
                            locked={u.reingestLocked}
                            canForce={canForce}
                          />
                        </div>
                        <ImportProblem lastError={job?.lastError} status={status} />
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>

              {/* Desktop table — same editorial hairline pattern as the CV
                tables, so the two most-visited pages read as one app. Built
                on DataTable (a named caption, th scope="col"). The scroll
                box is a named, focusable region so a keyboard user can
                scroll a row that holds no link (axe
                scrollable-region-focusable). */}
              <div className="panel hidden overflow-hidden md:block">
                <div
                  role="region"
                  aria-label="Imported tournament links"
                  tabIndex={0}
                  className="max-w-full overflow-x-auto"
                >
                  <Table label="Imported tournament links" className="w-full min-w-max">
                    <thead>
                      <tr>
                        <Th className="pl-4">URL</Th>
                        <Th>Tournament</Th>
                        <Th>Status</Th>
                        <Th numeric>Received</Th>
                        <Th className="pr-4 text-right">Actions</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(({ u, job, status }) => (
                        <Tr key={u.id} className="align-top">
                          <Td className="pl-4">
                            <a
                              href={u.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-6 max-w-md items-center gap-1 truncate font-mono text-caption text-ink transition-colors hover:text-primary"
                            >
                              <span className="truncate">{u.url}</span>
                              <span className="sr-only">(opens in a new tab)</span>
                              <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="sr-only"> (opens in new tab)</span>
                            </a>
                          </Td>
                          <Td className="text-ink">
                            <div>
                              {u.tournament?.name ?? <span className="text-ink-soft">—</span>}
                            </div>
                            <TournamentMetrics
                              tournament={u.tournament}
                              ingestedAt={u.ingestedAt}
                            />
                          </Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <StatusPill status={status} />
                              {u.reingestLocked ? <span className="data-label">Locked</span> : null}
                            </div>
                            <ImportProblem lastError={job?.lastError} status={status} />
                          </Td>
                          <Td numeric className="text-caption text-ink-soft">
                            {u.messageDate ? formatDate(u.messageDate) : '—'}
                          </Td>
                          <Td className="pr-4 text-right">
                            <RowActions
                              url={u.url}
                              tournamentId={u.tournament?.id.toString() ?? null}
                              tournamentName={u.tournament?.name ?? null}
                              status={status}
                              locked={u.reingestLocked}
                              canForce={canForce}
                            />
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
              {pageInfo.pages > 1 ? (
                <nav
                  aria-label="Import pages"
                  className="flex flex-wrap items-center justify-between gap-3 text-ui"
                  data-print-hide="true"
                >
                  {pageInfo.page > 1 ? (
                    <Link
                      href={pageHref(pageInfo.page - 1)}
                      className={buttonClasses({ variant: 'outline', size: 'sm' })}
                    >
                      ← Newer
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span aria-current="page" className="text-caption text-ink-soft">
                    Page {pageInfo.page} of {pageInfo.pages}
                  </span>
                  {pageInfo.page < pageInfo.pages ? (
                    <Link
                      href={pageHref(pageInfo.page + 1)}
                      className={buttonClasses({ variant: 'outline', size: 'sm' })}
                    >
                      Older →
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function FilterChip({
  activeFilter,
  filter,
  label,
}: {
  activeFilter: FilterKey;
  filter: FilterKey;
  label: string;
}) {
  const active = activeFilter === filter;
  return (
    <Link
      // Always carry the filter param — a bare /dashboard is the summary
      // view, so "All" must say ?filter=all to keep the table open.
      href={`/dashboard?filter=${filter}`}
      // The chips refine the table in place; re-scrolling to the top on
      // every click lost the user's place (NV-24).
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-1 text-caption font-medium transition-colors coarse:min-h-[44px]',
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-border bg-card text-ink hover:bg-surface-2',
      )}
    >
      {label}
    </Link>
  );
}

function RowActions({
  url,
  tournamentId,
  tournamentName,
  status,
  locked,
  canForce,
}: {
  url: string;
  tournamentId: string | null;
  tournamentName: string | null;
  status: PillStatus;
  locked: boolean;
  canForce: boolean;
}) {
  // The tournament name (or the URL's host) goes into every action's
  // accessible name so the rows are told apart (NV-13).
  const rowName = tournamentName ?? new URL(url).host;
  // Each status surfaces its primary action(s). Lock toggle stays on the
  // `done` and `unmatched` rows since those are the only states where
  // re-ingest is a meaningful concern.
  if (status === 'pending' || status === 'running') {
    return <IngestButton url={url} alreadyDone={false} name={rowName} />;
  }
  if (status === 'failed') {
    return (
      <div className="flex items-center justify-end gap-3">
        <ClearButton url={url} name={rowName} />
        <IngestButton url={url} alreadyDone={false} name={rowName} />
      </div>
    );
  }
  if (status === 'unmatched' && tournamentId && tournamentName) {
    return <UnmatchedRowExpand tournamentId={tournamentId} tournamentName={tournamentName} />;
  }
  if (status === 'done') {
    return (
      <div className="flex items-center justify-end gap-3">
        <LockUrlButton url={url} locked={locked} name={rowName} />
        <IngestButton url={url} alreadyDone={true} name={rowName} canForce={canForce} />
      </div>
    );
  }
  // unavailable: no action; pill itself is the whole UI.
  return null;
}

function TournamentMetrics({
  tournament,
  ingestedAt,
}: {
  tournament: { totalTeams: number | null; totalParticipants: number | null } | null | undefined;
  ingestedAt: Date | null;
}) {
  if (!tournament) return null;
  const { totalTeams, totalParticipants } = tournament;
  const hasMetrics = (totalTeams ?? 0) > 0 || (totalParticipants ?? 0) > 0;

  if (ingestedAt && !hasMetrics) {
    return (
      <div className="mt-0.5 flex items-center gap-1 text-caption text-warning">
        <Warning className="h-3.5 w-3.5 shrink-0" aria-hidden />
        No data scraped
      </div>
    );
  }
  if (!hasMetrics) return null;

  const parts: string[] = [];
  if (totalTeams) parts.push(`${totalTeams} teams`);
  if (totalParticipants) parts.push(`${totalParticipants} participants`);

  return <div className="mt-0.5 text-caption text-ink-soft">{parts.join(' · ')}</div>;
}

/**
 * What went wrong with a row, in words, with the raw text one click away.
 *
 * `lastError` is a scraper exception or, on a finished row, the parse
 * warnings the ingest route stores there. It used to be printed verbatim in
 * red under every such row, so a finished import with one unreadable
 * optional page looked like a failure, and a real failure read as
 * "fetch landing … → HTTP 503". The raw text stays behind "Technical
 * detail" for the user who wants to report it.
 */
function ImportProblem({
  lastError,
  status,
}: {
  lastError: string | null | undefined;
  status: PillStatus;
}) {
  // Unavailable rows say everything with their pill.
  if (!lastError || status === 'unavailable') return null;
  const failed = status === 'failed';
  const finished = status === 'done' || status === 'unmatched';
  const summary = failed
    ? ingestErrorCategory(lastError)
    : finished
      ? 'Partial data: some pages of this tab could not be read.'
      : `The last attempt did not finish and will be retried. ${ingestErrorCategory(lastError)}`;
  return (
    <div className="mt-1 max-w-xs text-caption">
      <p
        className={cn(
          'flex items-start gap-1',
          failed ? 'text-destructive' : finished ? 'text-warning' : 'text-ink-soft',
        )}
      >
        {failed || finished ? (
          <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : null}
        <span className="whitespace-normal">{summary}</span>
      </p>
      <details className="text-ink-soft">
        <summary className="inline-block cursor-pointer py-1 underline-offset-2 hover:underline">
          Technical detail
        </summary>
        <pre className="whitespace-pre-wrap break-all font-mono text-byline">{lastError}</pre>
      </details>
    </div>
  );
}

/**
 * Day-month-year, the order the Record header uses. `toLocaleDateString()`
 * with no locale followed the browser, so the same import read 20/5/2025 on
 * one machine and 5/20/2025 on another.
 */
function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
