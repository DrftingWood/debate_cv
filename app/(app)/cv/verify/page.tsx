import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { VerifyMineOnlyToggle } from '@/components/VerifyMineOnlyToggle';
import { CvSubNav } from '@/components/CvSubNav';
import { ReingestButton } from '@/components/ReingestButton';
import { deepestOutroundAcrossRoles } from '@/lib/calicotab/judgeStats';

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

  // Pull the latest ParserRun warnings per (tournament, parserName). When a
  // parser silently fails (e.g. the Debates card heading doesn't match, the
  // adjudicator <strong> marker is missing), it pushes a string into
  // ParserRun.warnings. Surfacing those here turns silent CV blanks into
  // diagnosable text without the user opening DevTools or DB.
  const userUrls = discovered.map((d) => d.url);
  const userTournamentByUrl = new Map<string, bigint>();
  for (const d of discovered) {
    if (d.tournamentId) userTournamentByUrl.set(d.url, d.tournamentId);
  }
  const parserRuns = userUrls.length
    ? await prisma.parserRun.findMany({
        where: { sourceDocument: { url: { in: userUrls } } },
        include: { sourceDocument: { select: { url: true } } },
        orderBy: { createdAt: 'desc' },
      })
    : [];
  const seenByTournamentParser = new Set<string>();
  const warningsByTournamentId = new Map<bigint, string[]>();
  for (const pr of parserRuns) {
    const tid = userTournamentByUrl.get(pr.sourceDocument.url);
    if (!tid) continue;
    const key = `${tid}|${pr.parserName}`;
    if (seenByTournamentParser.has(key)) continue;
    seenByTournamentParser.add(key);
    if (pr.warnings.length === 0) continue;
    const existing = warningsByTournamentId.get(tid) ?? [];
    const labeled = pr.warnings.map((w) => `[${pr.parserName}] ${w}`);
    warningsByTournamentId.set(tid, [...existing, ...labeled]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header className="space-y-3">
          <div className="kicker">VERIFY</div>
          <h1 className="font-display text-h2 font-semibold text-ink">
            Check what the parser read.
          </h1>
          <hr className="hairline" />
          <p className="text-body text-ink-soft">
            Everything extracted from your 5 most recent tournaments. If a number
            on your CV looks wrong, this is where to see what the parser actually
            read from the source.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <VerifyMineOnlyToggle mine={mineOnly} />
        </div>
      </div>

      <CvSubNav active="verify" />

      {ordered.length === 0 ? (
        <Card>
          <CardBody className="text-ui text-ink-soft">
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
                      <h2 className="font-display text-h3 font-semibold text-ink">
                        {t.name}
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-soft">
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
                        className="inline-flex items-center gap-1 text-caption text-ink-soft hover:text-oxblood"
                      >
                        Source <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                      <ReingestButton url={t.sourceUrlRaw} />
                    </div>
                  </div>

                  {warningsByTournamentId.has(t.id) ? (
                    <section className="space-y-2 rounded-md border border-oxblood/30 bg-oxblood/[0.04] p-3">
                      <h3 className="text-body font-semibold text-oxblood">
                        Parser warnings ({warningsByTournamentId.get(t.id)!.length})
                      </h3>
                      <ul className="space-y-1 text-caption text-ink">
                        {warningsByTournamentId.get(t.id)!.map((w, i) => (
                          <li key={i} className="font-mono">{w}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {/* Participants */}
                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display font-semibold text-ink">
                        Participants {mineOnly ? '(mine only)' : `(${t.participants.length})`}
                      </h3>
                      {mineOnly && participants.length === 0 ? (
                        <span className="text-caption text-ink-soft">
                          No claimed persons for this tournament.
                        </span>
                      ) : null}
                    </div>
                    {/* Desktop: 13-column table. md+ only. */}
                    <div className="hidden max-w-full overflow-x-auto md:block">
                      <table className="min-w-max text-table">
                        <thead>
                          <tr className="border-y border-ink/15 text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                            <th className="whitespace-nowrap px-4 py-2.5 font-medium">Name</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Roles</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Team</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Speaker total</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Open / ESL / EFL rank</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Team break rank</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Broken</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Last outround spoken</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Judge tag</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Inrounds chaired</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Last outround chaired</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Last outround judged</th>
                            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Per-round scores</th>
                          </tr>
                        </thead>
                        <tbody>
                          {participants.map((p) => (
                            <tr key={p.id.toString()} className="border-b border-ink/10 hover:bg-ink/[0.02]">
                              <td className="px-4 py-2.5">
                                {p.person.displayName}
                                {p.person.claimedByUserId === userId ? (
                                  <Badge variant="success" className="ml-2">You</Badge>
                                ) : null}
                              </td>
                              <td className="px-3 py-2.5 text-ink-soft">
                                {p.roles.map((r) => r.role).join(', ') || '—'}
                              </td>
                              <td className="px-3 py-2.5">{p.teamName ?? '—'}</td>
                              <td className="px-3 py-2.5 num font-mono">
                                {p.speakerScoreTotal?.toString() ?? '—'}
                              </td>
                              <td className="px-3 py-2.5 num font-mono">
                                {p.speakerRankOpen ?? '—'} / {p.speakerRankEsl ?? '—'} /{' '}
                                {p.speakerRankEfl ?? '—'}
                              </td>
                              <td className="px-3 py-2.5 num font-mono">
                                {p.teamBreakRank ?? '—'}
                              </td>
                              <td className="px-3 py-2.5">
                                {p.eliminationReached || p.teamBreakRank != null ? (
                                  <Badge variant="success">Yes</Badge>
                                ) : (
                                  <Badge variant="neutral">No</Badge>
                                )}
                              </td>
                              <td className="px-3 py-2.5">{p.eliminationReached ?? '—'}</td>
                              <td className="px-3 py-2.5 text-ink-soft">{p.judgeTypeTag ?? '—'}</td>
                              <td className="px-3 py-2.5 num font-mono">
                                {p.chairedPrelimRounds ?? '—'}
                              </td>
                              <td className="px-3 py-2.5">{p.lastOutroundChaired ?? '—'}</td>
                              <td className="px-3 py-2.5">
                                {deepestOutroundAcrossRoles(
                                  p.lastOutroundChaired,
                                  p.lastOutroundPaneled,
                                ) ?? '—'}
                              </td>
                              <td className="px-3 py-2.5">
                                {p.speakerRoundScores.length === 0 ? (
                                  '—'
                                ) : (
                                  <details>
                                    <summary className="cursor-pointer text-oxblood hover:underline">
                                      {p.speakerRoundScores.length} rounds
                                    </summary>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {p.speakerRoundScores.map((s) => (
                                        <span
                                          key={s.id.toString()}
                                          className="rounded border border-ink/10 bg-paper px-1.5 py-0.5 font-mono"
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

                    {/* Mobile: stacked card per participant. The 13-column table
                        is unusable on phones via horizontal scroll alone. Cards
                        group fields into Identity / Speaker / Judge sections;
                        Per-round scores stays behind a <details> to keep the
                        card scannable. */}
                    <ul className="space-y-3 md:hidden">
                      {participants.map((p) => {
                        const isYou = p.person.claimedByUserId === userId;
                        const broke = !!p.eliminationReached || p.teamBreakRank != null;
                        const lastOutroundJudged = deepestOutroundAcrossRoles(
                          p.lastOutroundChaired,
                          p.lastOutroundPaneled,
                        );
                        const ranks = [
                          p.speakerRankOpen != null ? `#${p.speakerRankOpen} Open` : null,
                          p.speakerRankEsl != null ? `#${p.speakerRankEsl} ESL` : null,
                          p.speakerRankEfl != null ? `#${p.speakerRankEfl} EFL` : null,
                        ].filter(Boolean).join(' · ');
                        const hasSpeakerData =
                          p.teamName ||
                          p.speakerScoreTotal != null ||
                          p.speakerRankOpen != null ||
                          ranks ||
                          p.teamBreakRank != null ||
                          broke;
                        const hasJudgeData =
                          p.judgeTypeTag ||
                          p.chairedPrelimRounds != null ||
                          p.lastOutroundChaired ||
                          lastOutroundJudged;
                        return (
                          <li
                            key={p.id.toString()}
                            className="rounded-md border border-ink/10 bg-paper p-3 space-y-2.5"
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <div className="font-medium text-ink">
                                {p.person.displayName}
                                {isYou ? (
                                  <Badge variant="success" className="ml-2">You</Badge>
                                ) : null}
                              </div>
                              <div className="text-caption text-ink-soft">
                                {p.roles.map((r) => r.role).join(', ') || '—'}
                              </div>
                            </div>
                            {hasSpeakerData ? (
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption">
                                {p.teamName ? (
                                  <VerifyField label="Team" value={p.teamName} />
                                ) : null}
                                {p.speakerScoreTotal != null ? (
                                  <VerifyField
                                    label="Speaker total"
                                    value={p.speakerScoreTotal.toString()}
                                    mono
                                  />
                                ) : null}
                                {ranks ? <VerifyField label="Rank" value={ranks} /> : null}
                                {p.teamBreakRank != null ? (
                                  <VerifyField
                                    label="Team break rank"
                                    value={`#${p.teamBreakRank}`}
                                    mono
                                  />
                                ) : null}
                                <VerifyField
                                  label="Broken"
                                  value={broke ? 'Yes' : 'No'}
                                />
                                {p.eliminationReached ? (
                                  <VerifyField
                                    label="Last outround spoken"
                                    value={p.eliminationReached}
                                  />
                                ) : null}
                              </dl>
                            ) : null}
                            {hasJudgeData ? (
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption border-t border-ink/10 pt-2">
                                {p.judgeTypeTag ? (
                                  <VerifyField label="Judge tag" value={p.judgeTypeTag} />
                                ) : null}
                                {p.chairedPrelimRounds != null ? (
                                  <VerifyField
                                    label="Inrounds chaired"
                                    value={String(p.chairedPrelimRounds)}
                                    mono
                                  />
                                ) : null}
                                {p.lastOutroundChaired ? (
                                  <VerifyField
                                    label="Last outround chaired"
                                    value={p.lastOutroundChaired}
                                  />
                                ) : null}
                                {lastOutroundJudged ? (
                                  <VerifyField
                                    label="Last outround judged"
                                    value={lastOutroundJudged}
                                  />
                                ) : null}
                              </dl>
                            ) : null}
                            {p.speakerRoundScores.length > 0 ? (
                              <details className="text-caption border-t border-ink/10 pt-2">
                                <summary className="cursor-pointer text-oxblood hover:underline">
                                  Per-round scores ({p.speakerRoundScores.length})
                                </summary>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {p.speakerRoundScores.map((s) => (
                                    <span
                                      key={s.id.toString()}
                                      className="rounded border border-ink/10 bg-paper px-1.5 py-0.5 font-mono"
                                    >
                                      R{s.roundNumber}
                                      {s.positionLabel ? ` · ${s.positionLabel}` : ''}
                                      {' · '}
                                      {s.score?.toString() ?? '—'}
                                    </span>
                                  ))}
                                </div>
                              </details>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>

                  {/* Judge assignments as grouped badges, not a joined string. */}
                  <section className="space-y-2">
                    <h3 className="font-display font-semibold text-ink">
                      Judge assignments ({t.judgeAssignments.length})
                    </h3>
                    {t.judgeAssignments.length === 0 ? (
                      <div className="text-caption text-ink-soft">
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
                            <span className="font-mono text-byline">
                              {a.stage ?? `R${a.roundNumber ?? '?'}`}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Break rows as grouped badges. */}
                  <section className="space-y-2">
                    <h3 className="font-display font-semibold text-ink">
                      Break results ({t.eliminationResults.length})
                    </h3>
                    {t.eliminationResults.length === 0 ? (
                      <div className="text-caption text-ink-soft">
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
                                <span className="font-mono text-byline">{e.result}</span>
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

function VerifyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-caption text-ink-soft">{label}</dt>
      <dd className={'mt-0.5 text-ink ' + (mono ? 'font-mono' : '')}>{value}</dd>
    </div>
  );
}
