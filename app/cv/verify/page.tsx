import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Extracted Data Verification',
  description: 'Verify parsed tournament data from your most recent private URLs.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CvVerifyPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const discovered = await prisma.discoveredUrl.findMany({
    where: { userId, tournamentId: { not: null } },
    include: { tournament: true },
    orderBy: [{ messageDate: 'desc' }, { createdAt: 'desc' }],
  });

  const picked = new Map<bigint, NonNullable<(typeof discovered)[number]['tournament']>>();
  for (const row of discovered) {
    if (!row.tournament || picked.has(row.tournament.id)) continue;
    picked.set(row.tournament.id, row.tournament);
    if (picked.size >= 5) break;
  }

  const tournamentIds = Array.from(picked.keys());
  const tournaments = tournamentIds.length
    ? await prisma.tournament.findMany({
        where: { id: { in: tournamentIds } },
        include: {
          participants: {
            include: {
              person: true,
              roles: true,
              speakerRoundScores: { orderBy: { roundNumber: 'asc' } },
            },
            orderBy: { createdAt: 'asc' },
          },
          eliminationResults: true,
          judgeAssignments: { include: { person: true }, orderBy: [{ roundNumber: 'asc' }, { stage: 'asc' }] },
          teamResults: { orderBy: [{ roundNumber: 'asc' }, { teamName: 'asc' }] },
        },
      })
    : [];

  const ordered = tournamentIds
    .map((id) => tournaments.find((t) => t.id === id))
    .filter((t): t is (typeof tournaments)[number] => !!t);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-h2 font-semibold text-foreground">
            Extracted data verification
          </h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Showing all parsed fields for your 5 most recent tournaments.
          </p>
        </div>
        <Link href="/cv">
          <Button variant="outline" leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
            Back to My CV
          </Button>
        </Link>
      </div>

      {ordered.length === 0 ? (
        <Card>
          <CardBody className="text-[14px] text-muted-foreground">
            No ingested tournaments found yet.
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          {ordered.map((t) => {
            const tAny = t as unknown as Record<string, unknown>;
            return (
              <Card key={t.id.toString()}>
                <CardBody className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-display text-[18px] font-semibold text-foreground">
                        {t.name}
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                        <Badge variant="outline">Year: {t.year ?? '—'}</Badge>
                        <Badge variant="outline">Format: {t.format ?? '—'}</Badge>
                        <Badge variant="outline">
                          Participants: {String(tAny.totalParticipants ?? '—')}
                        </Badge>
                        <Badge variant="outline">Teams: {String(tAny.totalTeams ?? '—')}</Badge>
                      </div>
                    </div>
                    <a
                      href={t.sourceUrlRaw}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-primary"
                    >
                      Source <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </div>

                  <section className="space-y-2">
                    <h3 className="text-[14px] font-semibold text-foreground">Participants</h3>
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-caption">
                        <thead className="bg-muted/50 text-left text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5">Name</th>
                            <th className="px-2 py-1.5">Roles</th>
                            <th className="px-2 py-1.5">Team</th>
                            <th className="px-2 py-1.5">Speaker total</th>
                            <th className="px-2 py-1.5">Open / ESL / EFL rank</th>
                            <th className="px-2 py-1.5">Team break rank</th>
                            <th className="px-2 py-1.5">Judge tag</th>
                            <th className="px-2 py-1.5">Chaired prelims</th>
                            <th className="px-2 py-1.5">Last out-round (chair/panel)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {t.participants.map((p) => {
                            const pAny = p as unknown as Record<string, unknown>;
                            return (
                              <tr key={p.id.toString()}>
                                <td className="px-2 py-1.5">{p.person.displayName}</td>
                                <td className="px-2 py-1.5">{p.roles.map((r) => r.role).join(', ') || '—'}</td>
                                <td className="px-2 py-1.5">{p.teamName ?? '—'}</td>
                                <td className="px-2 py-1.5">{p.speakerScoreTotal?.toString() ?? '—'}</td>
                                <td className="px-2 py-1.5">
                                  {String(pAny.speakerRankOpen ?? '—')} / {String(pAny.speakerRankEsl ?? '—')} / {String(pAny.speakerRankEfl ?? '—')}
                                </td>
                                <td className="px-2 py-1.5">{String(pAny.teamBreakRank ?? '—')}</td>
                                <td className="px-2 py-1.5">{String(pAny.judgeTypeTag ?? '—')}</td>
                                <td className="px-2 py-1.5">{String(pAny.chairedPrelimRounds ?? '—')}</td>
                                <td className="px-2 py-1.5">
                                  {String(pAny.lastOutroundChaired ?? '—')} / {String(pAny.lastOutroundPaneled ?? '—')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-[14px] font-semibold text-foreground">Judge assignments</h3>
                    <div className="text-caption text-muted-foreground">
                      {t.judgeAssignments.length === 0
                        ? 'No parsed judge assignments'
                        : t.judgeAssignments
                            .map((a) => `${a.person.displayName} · ${a.panelRole ?? '—'} · ${a.stage ?? `Round ${a.roundNumber ?? '?'}`}`)
                            .join(' | ')}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-[14px] font-semibold text-foreground">Break results</h3>
                    <div className="text-caption text-muted-foreground">
                      {t.eliminationResults.length === 0
                        ? 'No parsed break rows'
                        : t.eliminationResults
                            .map((e) => `${e.entityType}: ${e.entityName} @ ${e.stage} (${e.result ?? '—'})`)
                            .join(' | ')}
                    </div>
                  </section>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
