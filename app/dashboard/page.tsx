import { redirect } from 'next/navigation';
import { Inbox, Clock, CheckCircle2, XCircle, ExternalLink, Link2 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBadge, SignOutButton } from '@/components/SignInOut';
import { ScanButton, IngestAllButton, IngestButton } from '@/components/DashboardActions';
import { IdentityReview, type ReviewItem } from '@/components/IdentityReview';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

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
    <div className="space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-1">Dashboard</h1>
          <SessionBadge />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pending > 0 ? <IngestAllButton pendingCount={pending} /> : null}
          <ScanButton />
          <SignOutButton />
        </div>
      </header>

      <IdentityReview items={reviewItems} hasExistingClaims={claimsCount > 0} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          icon={<Link2 className="h-4 w-4" aria-hidden />}
          label="Private URLs"
          value={urls.length}
          tone="info"
        />
        <Stat
          icon={<Clock className="h-4 w-4" aria-hidden />}
          label="Pending"
          value={pending + running}
          tone={pending + running > 0 ? 'warning' : 'neutral'}
          subvalue={running > 0 ? `${running} running` : undefined}
        />
        <Stat
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
          label="Done"
          value={done}
          tone={done > 0 ? 'success' : 'neutral'}
        />
        <Stat
          icon={<XCircle className="h-4 w-4" aria-hidden />}
          label="Failed"
          value={failed}
          tone={failed > 0 ? 'danger' : 'neutral'}
        />
      </section>

      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink-1">Private URLs</h2>
          {urls.length > 0 ? (
            <span className="text-xs text-ink-4">{urls.length} total · most recent first</span>
          ) : null}
        </header>
        {urls.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" aria-hidden />}
            title="No private URLs yet"
            description="Click Scan Gmail to search your inbox for Tabbycat private URLs. We'll auto-ingest them in the same click."
          />
        ) : (
          <>
            {/* Mobile: card list */}
            <ul className="space-y-2 md:hidden">
              {urls.map((u) => {
                const job = jobByUrl.get(u.url);
                const status = statusFor(!!u.ingestedAt, job?.status);
                return (
                  <li key={u.id}>
                    <Card>
                      <CardBody className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-ink-1">
                              {u.tournament?.name ?? '—'}
                            </div>
                            <a
                              href={u.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 flex items-center gap-1 truncate font-mono text-xs text-ink-4 hover:text-primary-600"
                            >
                              {u.url}
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                            </a>
                          </div>
                          <StatusBadge status={status} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-ink-4">
                          <span>{u.messageDate ? new Date(u.messageDate).toLocaleDateString() : '—'}</span>
                          <IngestButton url={u.url} alreadyDone={!!u.ingestedAt} />
                        </div>
                        {job?.lastError && !u.ingestedAt ? (
                          <div className="rounded bg-danger-50 p-2 text-xs text-danger-700">
                            {job.lastError}
                          </div>
                        ) : null}
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: table */}
            <Card className="hidden overflow-hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-bg-subtle text-left text-xs font-medium text-ink-4">
                  <tr>
                    <th className="px-4 py-2.5">URL</th>
                    <th className="px-4 py-2.5">Tournament</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Received</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {urls.map((u) => {
                    const job = jobByUrl.get(u.url);
                    const status = statusFor(!!u.ingestedAt, job?.status);
                    return (
                      <tr key={u.id} className="align-top hover:bg-bg-subtle">
                        <td className="px-4 py-3">
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-[28rem] items-center gap-1 truncate align-bottom font-mono text-xs text-ink-2 hover:text-primary-600"
                          >
                            <span className="truncate">{u.url}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                          </a>
                        </td>
                        <td className="px-4 py-3 text-ink-2">
                          {u.tournament?.name ?? <span className="text-ink-5">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={status} />
                          {job?.lastError && !u.ingestedAt ? (
                            <div
                              className="mt-1 max-w-xs truncate text-xs text-danger-600"
                              title={job.lastError}
                            >
                              {job.lastError}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-4">
                          {u.messageDate ? new Date(u.messageDate).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <IngestButton url={u.url} alreadyDone={!!u.ingestedAt} />
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

type UrlStatus = 'done' | 'pending' | 'running' | 'failed';

function statusFor(ingested: boolean, jobStatus: string | undefined): UrlStatus {
  if (ingested) return 'done';
  if (jobStatus === 'running') return 'running';
  if (jobStatus === 'failed') return 'failed';
  return 'pending';
}

function StatusBadge({ status }: { status: UrlStatus }) {
  if (status === 'done')
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        Done
      </Badge>
    );
  if (status === 'running')
    return (
      <Badge variant="info">
        <Clock className="h-3 w-3" aria-hidden />
        Running
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge variant="danger">
        <XCircle className="h-3 w-3" aria-hidden />
        Failed
      </Badge>
    );
  return (
    <Badge variant="warning">
      <Clock className="h-3 w-3" aria-hidden />
      Pending
    </Badge>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
  subvalue,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  subvalue?: string;
}) {
  const toneRing: Record<typeof tone, string> = {
    info: 'text-primary-700 bg-primary-50',
    success: 'text-success-700 bg-success-50',
    warning: 'text-warning-800 bg-warning-50',
    danger: 'text-danger-700 bg-danger-50',
    neutral: 'text-ink-4 bg-bg-muted',
  };
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-md ${toneRing[tone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-ink-4">{label}</div>
          <div className="text-xl font-semibold text-ink-1 leading-tight">{value}</div>
          {subvalue ? <div className="mt-0.5 text-xs text-ink-4">{subvalue}</div> : null}
        </div>
      </CardBody>
    </Card>
  );
}
