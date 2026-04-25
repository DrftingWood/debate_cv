import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  Inbox,
  Clock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Link2,
  Search,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBadge, SignOutButton } from '@/components/SignInOut';
import {
  ScanButton,
  IngestAllButton,
  IngestButton,
  ClearButton,
  ReingestMineButton,
  ExportErrorsButton,
} from '@/components/DashboardActions';
import { IdentityReview, type ReviewItem } from '@/components/IdentityReview';
import { Card, CardBody } from '@/components/ui/Card';
import { StatusPill, type Status as PillStatus } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Scan Gmail, ingest Tabbycat private URLs, and track progress.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [urls, jobs, reviewPersons, claimsCount] = await Promise.all([
    prisma.discoveredUrl.findMany({
      where: { userId },
      orderBy: { messageDate: 'desc' },
      take: 100,
      include: { tournament: true },
    }),
    prisma.ingestJob.findMany({
      where: { userId },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    }),
    prisma.person.findMany({
      where: {
        claimedByUserId: null,
        rejections: { none: { userId } },
        discoveredOnUrls: { some: { userId } },
      },
      include: {
        discoveredOnUrls: { where: { userId }, include: { tournament: true } },
      },
      orderBy: { displayName: 'asc' },
      take: 50,
    }),
    prisma.person.count({ where: { claimedByUserId: userId } }),
  ]);

  const jobByUrl = new Map(jobs.map((j) => [j.url, j] as const));
  const pending = jobs.filter((j) => j.status === 'pending').length;
  const running = jobs.filter((j) => j.status === 'running').length;
  const done = jobs.filter((j) => j.status === 'done').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  const reviewItems: ReviewItem[] = reviewPersons.map((p) => ({
    personId: p.id.toString(),
    displayName: p.displayName,
    tournaments: p.discoveredOnUrls
      .map((u) => u.tournament)
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ id: t.id.toString(), name: t.name, year: t.year, host: t.sourceHost })),
  }));

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
          {pending > 0 ? <IngestAllButton pendingCount={pending} /> : null}
          <ScanButton />
          <ReingestMineButton />
          <ExportErrorsButton />
          <SignOutButton />
        </div>
      </header>

      {/* Identity review panel */}
      <IdentityReview items={reviewItems} hasExistingClaims={claimsCount > 0} />

      {/* Stats grid */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          icon={<Link2 className="h-4 w-4" aria-hidden />}
          label="Private URLs"
          value={urls.length}
          hint="from your Gmail"
          tone="info"
        />
        <Stat
          icon={<Clock className="h-4 w-4" aria-hidden />}
          label="Pending"
          value={pending + running}
          hint={running > 0 ? `${running} running` : 'queued for ingest'}
          tone={pending + running > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
          label="Done"
          value={done}
          hint="parsed and stored"
          tone={done > 0 ? 'success' : 'neutral'}
        />
        <Stat
          icon={<XCircle className="h-4 w-4" aria-hidden />}
          label="Failed"
          value={failed}
          hint="retry manually"
          tone={failed > 0 ? 'danger' : 'neutral'}
        />
      </section>

      {/* URL table */}
      <section className="space-y-4">
        <header className="flex items-end justify-between">
          <div>
            <h2 className="font-display text-h3 font-semibold text-foreground">Private URLs</h2>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {urls.length > 0
                ? `${urls.length} total · most recent first`
                : 'Nothing ingested yet'}
            </p>
          </div>
        </header>

        {urls.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" aria-hidden />}
            title="No private URLs yet"
            description="Click Scan Gmail to find Tabbycat private URLs in your inbox. We'll auto-ingest them in the same click."
            action={
              <div className="inline-flex items-center gap-2 text-caption text-muted-foreground">
                <Search className="h-3.5 w-3.5" aria-hidden /> Use the Scan Gmail button above
              </div>
            }
          />
        ) : (
          <>
            {/* Mobile */}
            <ul className="space-y-2 md:hidden">
              {urls.map((u) => {
                const job = jobByUrl.get(u.url);
                const status = statusFor(!!u.ingestedAt, job?.status);
                const noData =
                  !!u.ingestedAt &&
                  !((u.tournament?.totalTeams ?? 0) > 0 || (u.tournament?.totalParticipants ?? 0) > 0);
                return (
                  <li key={u.id}>
                    <Card>
                      <CardBody className="space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-display text-[14.5px] font-semibold text-foreground">
                              {u.tournament?.name ?? '—'}
                            </div>
                            <TournamentMetrics tournament={u.tournament} ingestedAt={u.ingestedAt} url={u.url} />
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
                            {u.messageDate ? new Date(u.messageDate).toLocaleDateString() : '—'}
                          </span>
                          <div className="flex items-center gap-1">
                            {status === 'failed' ? <ClearButton url={u.url} /> : null}
                            {!noData ? <IngestButton url={u.url} alreadyDone={!!u.ingestedAt} /> : null}
                          </div>
                        </div>
                        {job?.lastError ? (
                          !u.ingestedAt ? (
                            <div className="rounded-md bg-[hsl(var(--destructive)/0.08)] px-2.5 py-1.5 text-caption text-destructive">
                              {job.lastError}
                            </div>
                          ) : (u.tournament?.totalTeams == null || u.tournament.totalTeams === 0) ? (
                            <div className="rounded-md bg-[hsl(var(--warning)/0.08)] px-2.5 py-1.5 text-caption text-warning whitespace-pre-wrap break-all">
                              {job.lastError}
                            </div>
                          ) : null
                        ) : null}
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ul>

            {/* Desktop */}
            <Card className="hidden overflow-hidden md:block">
              <table className="w-full text-[13.5px]">
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
                  {urls.map((u) => {
                    const job = jobByUrl.get(u.url);
                    const status = statusFor(!!u.ingestedAt, job?.status);
                    const noData =
                      !!u.ingestedAt &&
                      !((u.tournament?.totalTeams ?? 0) > 0 || (u.tournament?.totalParticipants ?? 0) > 0);
                    return (
                      <tr key={u.id} className="align-middle transition-colors hover:bg-muted/40">
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
                          <div>{u.tournament?.name ?? <span className="text-muted-foreground/60">—</span>}</div>
                          <TournamentMetrics tournament={u.tournament} ingestedAt={u.ingestedAt} url={u.url} />
                        </td>
                        <td className="px-5 py-3">
                          <StatusPill status={status} />
                          {job?.lastError ? (
                            !u.ingestedAt ? (
                              <div
                                className="mt-1 max-w-xs truncate text-caption text-destructive"
                                title={job.lastError}
                              >
                                {job.lastError}
                              </div>
                            ) : (u.tournament?.totalTeams == null || u.tournament.totalTeams === 0) ? (
                              <div
                                className="mt-1 max-w-xs text-caption text-warning whitespace-pre-wrap break-all"
                                title={job.lastError}
                              >
                                {job.lastError}
                              </div>
                            ) : null
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-caption text-muted-foreground">
                          {u.messageDate ? new Date(u.messageDate).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {status === 'failed' ? <ClearButton url={u.url} /> : null}
                            {!noData ? <IngestButton url={u.url} alreadyDone={!!u.ingestedAt} /> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}

function TournamentMetrics({
  tournament,
  ingestedAt,
  url,
}: {
  tournament: { totalTeams: number | null; totalParticipants: number | null } | null | undefined;
  ingestedAt: Date | null;
  url?: string;
}) {
  if (!tournament) return null;
  const { totalTeams, totalParticipants } = tournament;
  const hasMetrics = (totalTeams ?? 0) > 0 || (totalParticipants ?? 0) > 0;

  if (ingestedAt && !hasMetrics) {
    return (
      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-caption text-warning">⚠ No data scraped</span>
        {url ? <IngestButton url={url} alreadyDone={true} /> : null}
      </div>
    );
  }
  if (!hasMetrics) return null;

  const parts: string[] = [];
  if (totalTeams) parts.push(`${totalTeams} teams`);
  if (totalParticipants) parts.push(`${totalParticipants} participants`);

  return (
    <div className="mt-0.5 text-caption text-muted-foreground">
      {parts.join(' · ')}
    </div>
  );
}

function statusFor(ingested: boolean, jobStatus: string | undefined): PillStatus {
  if (ingested) return 'done';
  if (jobStatus === 'running') return 'running';
  if (jobStatus === 'failed') return 'failed';
  return 'pending';
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneRing: Record<typeof tone, string> = {
    info: 'text-primary bg-primary-soft',
    success: 'text-success bg-[hsl(var(--success)/0.12)]',
    warning: 'text-warning bg-[hsl(var(--warning)/0.12)]',
    danger: 'text-destructive bg-[hsl(var(--destructive)/0.10)]',
    neutral: 'text-muted-foreground bg-muted',
  };
  return (
    <Card className="transition-all duration-[180ms] ease-soft hover:shadow-md">
      <CardBody className="flex items-center gap-3">
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
      </CardBody>
    </Card>
  );
}
