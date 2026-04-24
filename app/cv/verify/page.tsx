import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { VerifyMineOnlyToggle } from '@/components/VerifyMineOnlyToggle';
import { ReingestButton } from '@/components/ReingestButton';

export const metadata: Metadata = {
  title: 'Extracted Data Verification',
  description: 'Verify parsed tournament data from your most recent private URLs.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CvVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const { mine: mineParam } = await searchParams;
  const mineOnly = mineParam === '1';

  // Top 5 most recent tournaments: order DiscoveredUrl by message date then
  // creation, dedup by tournamentId, stop at 5.
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
          judgeAssignments: {
            include: { person: true },
            orderBy: [{ roundNumber: 'asc' }, { stage: 'asc' }],
          },
          teamResults: { orderBy: [{ roundNumber: 'asc' }, { teamName: 'asc' }] },
        },
      })
    : [];

  // Preserve the discovery order.
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
        <div className="flex flex-wrap items-center gap-2">
          <VerifyMineOnlyToggle mine={mineOnly} />
          <Link href="/cv">
            <Button variant="outline" leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Back to My CV
            </Button>
          </Link>
        </div>
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
            const participants = mineOnly
              ? t.participants.filter((p) => p.person.claimedByUserId === userId)
              : t.participants;

            return (
              <Card key={t.id.toString()}>
                <CardBody className="space-y-5">
                  {/* Tournament metadata */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-display text-[18px] font-semibold text-foreground">
                        {t.name}
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                        <Badge variant="outline">Year: {t.year ?? '—'}</Badge>
                        <Badge variant="outline">Format: {t.format ?? '—'}</Badge>
                        <Badge variant="outline">
                          Participants: {t.totalParticipants ?? '—'}
                        </Badge>
                        <Badge variant="outline">Teams: {t.totalTeams ?? '—'}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={t.sourceUrlRaw}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-primary"
                      >
                        Source <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                      <ReingestButton url={t.sourceUrlRaw} />
                    </div>
                  </div>

                  {/* Participants */}
                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[14px] font-semibold text-foreground">
                        Participants {mineOnly ? '(mine only)' : `(${t.participants.length})`}
                      </h3>
                      {mineOnly && participants.length === 0 ? (
                        <span className="text-caption text-muted-foreground">
                          No claimed persons for this tournament.
                        </span>
                      ) : null}
                    </div>
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
                            <th className="px-2 py-1.5">
                              Last out-round (chair / panel)
                            </th>
                            <th className="px-2 py-1.5">Per-round scores</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {participants.map((p) => (
                            <tr key={p.id.toString()}>
                              <td className="px-2 py-1.5">
                                {p.person.displayName}
                                {p.person.claimedByUserId === userId ? (
                                  <Badge variant="success" className="ml-2">You</Badge>
                                ) : null}
                              </td>
                              <td className="px-2 py-1.5">
                                {p.roles.map((r) => r.role).join(', ') || '—'}
                              </td>
                              <td className="px-2 py-1.5">{p.teamName ?? '—'}</td>
                              <td className="px-2 py-1.5 font-mono">
                                {p.speakerScoreTotal?.toString() ?? '—'}
                              </td>
                              <td className="px-2 py-1.5 font-mono">
                                {p.speakerRankOpen ?? '—'} / {p.speakerRankEsl ?? '—'} /{' '}
                                {p.speakerRankEfl ?? '—'}
                              </td>
                              <td className="px-2 py-1.5 font-mono">
                                {p.teamBreakRank ?? '—'}
                              </td>
                              <td className="px-2 py-1.5">{p.judgeTypeTag ?? '—'}</td>
                              <td className="px-2 py-1.5 font-mono">
                                {p.chairedPrelimRounds ?? '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                {p.lastOutroundChaired ?? '—'} / {p.lastOutroundPaneled ?? '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                {p.speakerRoundScores.length === 0 ? (
                                  '—'
                                ) : (
                                  <details>
                                    <summary className="cursor-pointer text-primary hover:underline">
                                      {p.speakerRoundScores.length} rounds
                                    </summary>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {p.speakerRoundScores.map((s) => (
                                        <span
                                          key={s.id.toString()}
                                          className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono"
                                        >
                                          R{s.roundNumber}
                                          {s.positionLabel ? ` · ${s.positionLabel}` : ''}
                                          {' · '}
                                          {s.score?.toString() ?? '—'}
                                        </span>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* Judge assignments as grouped badges, not a joined string. */}
                  <section className="space-y-2">
                    <h3 className="text-[14px] font-semibold text-foreground">
                      Judge assignments ({t.judgeAssignments.length})
                    </h3>
                    {t.judgeAssignments.length === 0 ? (
                      <div className="text-caption text-muted-foreground">
                        No parsed judge assignments.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {t.judgeAssignments.map((a) => (
                          <Badge
                            key={a.id.toString()}
                            variant={a.panelRole === 'chair' ? 'info' : 'outline'}
                          >
                            <span className="font-medium">{a.person.displayName}</span>
                            <span className="opacity-60">·</span>
                            <span>{a.panelRole ?? 'panel'}</span>
                            <span className="opacity-60">·</span>
                            <span className="font-mono text-[11px]">
                              {a.stage ?? `R${a.roundNumber ?? '?'}`}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Break rows as grouped badges. */}
                  <section className="space-y-2">
                    <h3 className="text-[14px] font-semibold text-foreground">
                      Break results ({t.eliminationResults.length})
                    </h3>
                    {t.eliminationResults.length === 0 ? (
                      <div className="text-caption text-muted-foreground">
                        No parsed break rows.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {t.eliminationResults.map((e) => (
                          <Badge key={e.id.toString()} variant="outline">
                            <span className="opacity-70">{e.entityType}</span>
                            <span className="opacity-60">·</span>
                            <span className="font-medium">{e.entityName}</span>
                            <span className="opacity-60">@</span>
                            <span>{e.stage}</span>
                            {e.result ? (
                              <>
                                <span className="opacity-60">·</span>
                                <span className="font-mono text-[11px]">{e.result}</span>
                              </>
                            ) : null}
                          </Badge>
                        ))}
                      </div>
                    )}
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
