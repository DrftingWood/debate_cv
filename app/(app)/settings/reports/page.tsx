import type { Metadata } from 'next';
import { Flag } from '@/components/ui/icons';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { categoryLabel } from '@/lib/cvErrorReports/categories';
import { formatDate } from '@/lib/utils/date';
import type { CvReportStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reports · Settings' };

function statusBadge(status: CvReportStatus) {
  switch (status) {
    case 'open':
      return <Badge variant="warning">Open</Badge>;
    case 'acknowledged':
      return <Badge variant="info">Acknowledged</Badge>;
    case 'fixed':
      return <Badge variant="success">Fixed</Badge>;
    case 'wont_fix':
      return <Badge variant="neutral">Won&apos;t fix</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}

export default async function ReportsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const reports = await prisma.cvErrorReport.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const tournamentIds = [...new Set(reports.flatMap((r) => r.tournamentIds))].filter((id) =>
    /^\d+$/.test(id),
  );
  const tournaments = tournamentIds.length
    ? await prisma.tournament.findMany({
        where: { id: { in: tournamentIds.map((id) => BigInt(id)) } },
        select: { id: true, name: true, year: true },
      })
    : [];
  const tournamentById = new Map(tournaments.map((t) => [t.id.toString(), t] as const));

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="kicker">SETTINGS · REPORTS</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">Reports</h1>
        <hr className="hairline" />
      </header>

      <Card>
        <CardBody className="pt-5 space-y-4">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-ink-soft" aria-hidden />
            <h2 className="font-display text-h3 font-medium text-ink">Your reports</h2>
          </div>

          {reports.length === 0 ? (
            <p className="text-ui text-ink-soft">
              No reports yet. Use <strong>Report</strong> on any Record row.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-card border border-border bg-card">
              {reports.map((r) => {
                const trainNames = r.tournamentIds
                  .map((id) => tournamentById.get(id))
                  .filter(Boolean)
                  .map((t) => `${t!.name}${t!.year ? ` (${t!.year})` : ''}`);
                return (
                  <li key={r.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {trainNames.length > 0 ? (
                        <span className="font-medium text-ink">{trainNames.join(', ')}</span>
                      ) : (
                        <span className="text-ink-soft">Unknown tournament</span>
                      )}
                      {statusBadge(r.status)}
                      <span className="text-caption text-ink-soft">{formatDate(r.createdAt)}</span>
                    </div>
                    {r.categories.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {r.categories.map((c) => (
                          <Badge key={c} variant="outline">
                            {categoryLabel(c)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {r.comment ? (
                      <p className="whitespace-pre-wrap text-table text-ink-soft">{r.comment}</p>
                    ) : null}
                    {r.adminNote ? (
                      <p className="rounded-md border border-border bg-paper p-2 text-caption text-ink">
                        <span className="font-medium">Note from us:</span> {r.adminNote}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
