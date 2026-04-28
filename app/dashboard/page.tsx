import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Inbox,
  Clock,
  XCircle,
  ExternalLink,
  Link2,
  UserSearch,
  Ban,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBadge, SignOutButton } from '@/components/SignInOut';
import {
  ScanButton,
  IngestAllButton,
  IngestButton,
  ClearButton,
  LockUrlButton,
  ExportErrorsButton,
} from '@/components/DashboardActions';
import { RetryFailedButton } from '@/components/RetryFailedButton';
import { UnmatchedRowExpand } from '@/components/UnmatchedRowExpand';
import { Card, CardBody } from '@/components/ui/Card';
import { StatusPill, type Status as PillStatus } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Scan Gmail, ingest Tabbycat private URLs, and track progress.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type FilterKey = 'all' | 'pending' | 'failed' | 'unmatched' | 'unavailable' | 'done';

const FILTER_KEYS: FilterKey[] = ['all', 'pending', 'failed', 'unmatched', 'unavailable', 'done'];

function isFilterKey(value: string | undefined): value is FilterKey {
  return !!value && (FILTER_KEYS as string[]).includes(value);
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: userId },
  });
  if (claimedCount === 0) redirect('/onboarding');

  const params = await searchParams;
  const activeFilter: FilterKey = isFilterKey(params.filter) ? params.filter : 'all';

  const [urls, jobs, claimedTournamentIds] = await Promise.all([
    prisma.discoveredUrl.findMany({
      where: { userId },
      orderBy: { messageDate: 'desc' },
      take: 200,
      include: { tournament: true },
    }),
    prisma.ingestJob.findMany({
      where: { userId },
      orderBy: { scheduledAt: 'desc' },
      take: 200,
    }),
    prisma.tournamentParticipant
      .findMany({
        where: { person: { claimedByUserId: userId } },
        select: { tournamentId: true },
        distinct: ['tournamentId'],
      })
      .then((rows) => new Set(rows.map((r) => r.tournamentId.toString()))),
  ]);

  const jobByUrl = new Map(jobs.map((j) => [j.url, j] as const));

  // Compute status per URL once. `unmatched` supersedes `done` when the URL
  // ingested but the user has no TournamentParticipant in the resulting
  // tournament — they need to claim themselves manually via the inline
  // search expander below.
  const rows = urls.map((u) => {
    const job = jobByUrl.get(u.url);
    const baseStatus = statusFor(!!u.ingestedAt, job?.status, job?.lastError);
    const tournamentIdStr = u.tournament?.id.toString();
    const isUnmatched =
      baseStatus === 'done' &&
      !!tournamentIdStr &&
      !claimedTournamentIds.has(tournamentIdStr);
    const status: PillStatus = isUnmatched ? 'unmatched' : baseStatus;
    return { u, job, status };
  });

  const counts: Record<FilterKey, number> = {
    all: rows.length,
    pending: rows.filter((r) => r.status === 'pending' || r.status === 'running').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    unmatched: rows.filter((r) => r.status === 'unmatched').length,
    unavailable: rows.filter((r) => r.status === 'unavailable').length,
    done: rows.filter((r) => r.status === 'done').length,
  };

  const filtered = rows.filter((r) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'pending')
      return r.status === 'pending' || r.status === 'running';
    return r.status === activeFilter;
  });

  return (
    <div className="space-y-10">
      {/* Greeting header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-display text-h2 md:text-h1 font-semibold tracking-tight text-foreground">
            Welcome back
          </h1>
          <div className="text-[14px] text-muted-foreground">
            <SessionBadge />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.pending > 0 ? <IngestAllButton pendingCount={counts.pending} /> : null}
          <ScanButton />
          <details className="group relative">
            <summary className="list-none">
              <span className="inline-flex h-11 cursor-pointer items-center rounded-md border border-border bg-card px-4 text-[14px] font-medium text-foreground shadow-xs transition-colors hover:bg-muted">
                More actions
              </span>
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-[260px] rounded-card border border-border bg-card p-2.5 shadow-lg">
              <div className="flex flex-col gap-1.5">
                <ExportErrorsButton />
                <div className="pt-1">
                  <SignOutButton />
                </div>
              </div>
            </div>
          </details>
        </div>
      </header>

      {/* Stat tiles — clickable filter shortcuts */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <FilterTile
          icon={<Link2 className="h-4 w-4" aria-hidden />}
          label="Private URLs"
          value={counts.all}
          hint="from your Gmail"
          tone="info"
          filter="all"
          activeFilter={activeFilter}
        />
        <FilterTile
          icon={<Clock className="h-4 w-4" aria-hidden />}
          label="Pending"
          value={counts.pending}
          hint="queued / running"
          tone={counts.pending > 0 ? 'warning' : 'neutral'}
          filter="pending"
          activeFilter={activeFilter}
        />
        <FilterTile
          icon={<UserSearch className="h-4 w-4" aria-hidden />}
          label="Unmatched"
          value={counts.unmatched}
          hint="need to claim yourself"
          tone={counts.unmatched > 0 ? 'warning' : 'neutral'}
          filter="unmatched"
          activeFilter={activeFilter}
        />
        <FilterTile
          icon={<XCircle className="h-4 w-4" aria-hidden />}
          label="Failed"
          value={counts.failed}
          hint="retry from chip below"
          tone={counts.failed > 0 ? 'danger' : 'neutral'}
          filter="failed"
          activeFilter={activeFilter}
        />
      </section>

      {/* URL table */}
      <section className="space-y-4">
        <header className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-h3 font-semibold text-foreground">Private URLs</h2>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {filtered.length === counts.all
                  ? `${counts.all} total · most recent first`
                  : `${filtered.length} of ${counts.all} · ${activeFilter}`}
              </p>
            </div>
          </div>

          {/* Filter chips + contextual bulk action */}
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
            {activeFilter === 'pending' && counts.pending > 0 ? (
              <IngestAllButton pendingCount={counts.pending} />
            ) : null}
          </div>
        </header>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" aria-hidden />}
            title="No private URLs yet"
            description="Click Scan Gmail to find Tabbycat private URLs in your inbox. We'll auto-ingest them in the same click."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Ban className="h-5 w-5" aria-hidden />}
            title={`No ${activeFilter} URLs`}
            description="Pick another filter chip above to see different URLs."
          />
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {filtered.map(({ u, job, status }) => (
                <li key={u.id}>
                  <Card>
                    <CardBody className="space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-display text-[14.5px] font-semibold text-foreground">
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
                            className="mt-1 flex items-center gap-1 truncate font-mono text-[11.5px] text-muted-foreground transition-colors hover:text-primary"
                          >
                            {u.url}
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                          </a>
                        </div>
                        <StatusPill status={status} />
                      </div>
                      <div className="flex items-center justify-between text-caption text-muted-foreground">
                        <span>
                          {u.messageDate
                            ? new Date(u.messageDate).toLocaleDateString()
                            : '—'}
                        </span>
                        <RowActions
                          url={u.url}
                          tournamentId={u.tournament?.id.toString() ?? null}
                          tournamentName={u.tournament?.name ?? null}
                          status={status}
                          locked={u.reingestLocked}
                        />
                      </div>
                      {job?.lastError && status !== 'unavailable' ? (
                        <div className="rounded-md bg-[hsl(var(--destructive)/0.08)] px-2.5 py-1.5 text-caption text-destructive whitespace-pre-wrap break-all">
                          {job.lastError}
                        </div>
                      ) : null}
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <Card className="hidden md:block">
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-max text-[13.5px]">
                  <thead className="border-b border-border bg-muted/60 text-left text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">URL</th>
                      <th className="px-5 py-3">Tournament</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Received</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map(({ u, job, status }) => (
                      <tr
                        key={u.id}
                        className="align-top transition-colors hover:bg-muted/40"
                      >
                        <td className="px-5 py-3">
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-[28rem] items-center gap-1 truncate font-mono text-[12px] text-foreground transition-colors hover:text-primary"
                          >
                            <span className="truncate">{u.url}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                          </a>
                        </td>
                        <td className="px-5 py-3 text-foreground">
                          <div>
                            {u.tournament?.name ?? (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </div>
                          <TournamentMetrics
                            tournament={u.tournament}
                            ingestedAt={u.ingestedAt}
                          />
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <StatusPill status={status} />
                            {u.reingestLocked ? (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                Locked
                              </span>
                            ) : null}
                          </div>
                          {job?.lastError && status !== 'unavailable' ? (
                            <div
                              className="mt-1 max-w-xs text-caption text-destructive whitespace-pre-wrap break-all"
                              title={job.lastError}
                            >
                              {job.lastError}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-caption text-muted-foreground">
                          {u.messageDate
                            ? new Date(u.messageDate).toLocaleDateString()
                            : '—'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <RowActions
                            url={u.url}
                            tournamentId={u.tournament?.id.toString() ?? null}
                            tournamentName={u.tournament?.name ?? null}
                            status={status}
                            locked={u.reingestLocked}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </section>
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
      href={filter === 'all' ? '/dashboard' : `/dashboard?filter=${filter}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-muted',
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
}: {
  url: string;
  tournamentId: string | null;
  tournamentName: string | null;
  status: PillStatus;
  locked: boolean;
}) {
  // Each status surfaces its primary action(s). Lock toggle stays on the
  // `done` and `unmatched` rows since those are the only states where
  // re-ingest is a meaningful concern.
  if (status === 'pending' || status === 'running') {
    return <IngestButton url={url} alreadyDone={false} />;
  }
  if (status === 'failed') {
    return (
      <div className="flex items-center justify-end gap-1">
        <ClearButton url={url} />
        <IngestButton url={url} alreadyDone={false} />
      </div>
    );
  }
  if (status === 'unmatched' && tournamentId && tournamentName) {
    return (
      <UnmatchedRowExpand tournamentId={tournamentId} tournamentName={tournamentName} />
    );
  }
  if (status === 'done') {
    return (
      <div className="flex items-center justify-end gap-1">
        <LockUrlButton url={url} locked={locked} />
        <IngestButton url={url} alreadyDone={true} />
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
      <div className="mt-0.5 text-caption text-warning">⚠ No data scraped</div>
    );
  }
  if (!hasMetrics) return null;

  const parts: string[] = [];
  if (totalTeams) parts.push(`${totalTeams} teams`);
  if (totalParticipants) parts.push(`${totalParticipants} participants`);

  return (
    <div className="mt-0.5 text-caption text-muted-foreground">{parts.join(' · ')}</div>
  );
}

function isPermanentlyDead(lastError: string | null | undefined): boolean {
  return !!lastError && /HTTP 404/.test(lastError);
}

function statusFor(
  ingested: boolean,
  jobStatus: string | undefined,
  lastError: string | null | undefined,
): PillStatus {
  if (isPermanentlyDead(lastError)) return 'unavailable';
  if (ingested) return 'done';
  if (jobStatus === 'running') return 'running';
  if (jobStatus === 'failed') return 'failed';
  return 'pending';
}

function FilterTile({
  icon,
  label,
  value,
  hint,
  tone,
  filter,
  activeFilter,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  filter: FilterKey;
  activeFilter: FilterKey;
}) {
  const toneRing: Record<typeof tone, string> = {
    info: 'text-primary bg-primary-soft',
    success: 'text-success bg-[hsl(var(--success)/0.12)]',
    warning: 'text-warning bg-[hsl(var(--warning)/0.12)]',
    danger: 'text-destructive bg-[hsl(var(--destructive)/0.10)]',
    neutral: 'text-muted-foreground bg-muted',
  };
  const active = activeFilter === filter;
  return (
    <Link
      href={filter === 'all' ? '/dashboard' : `/dashboard?filter=${filter}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'block rounded-card border bg-card transition-all duration-[180ms] ease-soft hover:shadow-md',
        active ? 'border-primary ring-2 ring-primary/30' : 'border-border',
      )}
    >
      <div className="flex items-center gap-3 p-5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${toneRing[tone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-caption text-muted-foreground">{label}</div>
          <div className="mt-0.5 font-display text-[26px] font-semibold leading-none text-foreground">
            {value}
          </div>
          {hint ? <div className="mt-2 text-caption text-muted-foreground">{hint}</div> : null}
        </div>
      </div>
    </Link>
  );
}
