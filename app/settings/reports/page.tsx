import { Flag } from 'lucide-react';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const dynamic = 'force-dynamic';

/**
 * Lists the user's CV error reports. For now this is read-only and shows
 * the existing CvErrorReport rows ordered newest-first. The structured
 * categories + closed-loop status (open / acknowledged / fixed / wont_fix)
 * land in a follow-up — that requires a schema change. The page exists
 * already so users can at least see what they've reported and refer back
 * to the comment if needed.
 */
export default async function ReportsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const reports = await prisma.cvErrorReport.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const tournamentIds = [...new Set(reports.flatMap((r) => r.tournamentIds))]
    .filter((id) => /^\d+$/.test(id));
  const tournaments = tournamentIds.length
    ? await prisma.tournament.findMany({
        where: { id: { in: tournamentIds.map((id) => BigInt(id)) } },
        select: { id: true, name: true, year: true },
      })
    : [];
  const tournamentById = new Map(
    tournaments.map((t) => [t.id.toString(), t] as const),
  );

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-display text-h3 font-semibold text-foreground">
            Your reports
          </h2>
        </div>

        {reports.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/40 p-4 text-caption text-muted-foreground">
            You haven&apos;t reported any CV issues yet. The Report button on
            each row of <strong>My CV</strong> opens a quick form for telling
            us when something looks wrong.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border bg-card">
            {reports.map((r) => {
              const trainNames = r.tournamentIds
                .map((id) => tournamentById.get(id))
                .filter(Boolean)
                .map((t) => `${t!.name}${t!.year ? ` (${t!.year})` : ''}`);
              return (
                <li key={r.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {trainNames.length > 0 ? (
                      <span className="font-medium text-foreground">
                        {trainNames.join(', ')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unknown tournament</span>
                    )}
                    <Badge variant={r.resolvedAt ? 'success' : 'neutral'}>
                      {r.resolvedAt ? 'Resolved' : 'Open'}
                    </Badge>
                    <span className="text-caption text-muted-foreground">
                      {r.createdAt.toLocaleDateString()}
                    </span>
                  </div>
                  {r.comment ? (
                    <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
                      {r.comment}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
