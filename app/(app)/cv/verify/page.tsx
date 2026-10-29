import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowSquareOut, CaretDown } from '@/components/ui/icons';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { FocusOnMount } from '@/components/FocusOnMount';
import { VerifyMineOnlyToggle } from '@/components/VerifyMineOnlyToggle';
import { ReingestButton } from '@/components/ReingestButton';
import { buttonClasses } from '@/components/ui/Button';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';
import { deepestOutroundAcrossRoles } from '@/lib/calicotab/judgeStats';
import { displayNameFor } from '@/lib/privacy/suppression';

export const metadata: Metadata = {
  title: 'Verify',
  description: 'Verify parsed tournament data from your most recent private URLs.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CvVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string; t?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  // An operator tool, not a participant feature: send everyone else back to the record.
  if (!isAdminEmail(session.user.email)) redirect('/cv');
  const userId = session.user.id;

  const { mine: mineParam, t: selectedParam } = await searchParams;
  // Defaults to the user's own rows. This is the page for checking your own
  // parse, and "everyone" put ~1,300 strangers and 9,700 px of scroll on a
  // phone ahead of your own row. `?mine=0` shows every participant.
  const mineOnly = mineParam !== '0';

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

  // The viewer's OWN private URL for each tournament. Tournament.sourceUrlRaw is
  // whoever ingested it first, so re-ingesting from that would hand this user
  // someone else's credential (and claim their registration person).
  const ownUrlByTournament = new Map<bigint, string>();
  for (const row of discovered) {
    if (row.tournamentId != null && !ownUrlByTournament.has(row.tournamentId)) {
      ownUrlByTournament.set(row.tournamentId, row.url);
    }
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

  /*
   * Only ONE tournament renders its parser output at a time.
   *
   * Rendering all five produced a 9.4 MB HTML document — 1,302 participant
   * rows, each with a desktop table row and a mobile card, on a page whose
   * entire purpose is "I think ONE number on my CV is wrong, show me what
   * the parser read". Folding it behind <details> fixed the 144-screen
   * scroll but still shipped every byte, so the page still took seconds to
   * parse and blew past a Playwright load timeout.
   *
   * The headers all render (they are cheap, and they are the index); the
   * selected one renders its detail. Selection is a query param so it
   * survives a refresh and can be linked to.
   */
  const selectedId =
    ordered.find((t) => t.id.toString() === selectedParam)?.id ?? ordered[0]?.id ?? null;

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
          <div className="kicker uppercase">Debate CV — Verify</div>
          <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
            Verify what we parsed
          </h1>
          <hr className="hairline" />
          <p className="text-body text-ink-soft">
            Everything extracted from your 5 most recent tournaments — if a number on your CV looks
            wrong, this is where to see what the parser actually read.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <VerifyMineOnlyToggle mine={mineOnly} />
        </div>
      </div>

      {ordered.length === 0 ? (
        <Card>
          <CardBody className="space-y-3 text-ui text-ink-soft">
            <p>No ingested tournaments found yet.</p>
            <Link href="/dashboard" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
              Open imports
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          {ordered.map((t) => {
            const participants = mineOnly
              ? t.participants.filter((p) => p.person.claimedByUserId === userId)
              : t.participants;
            const isSelected = t.id === selectedId;

            return (
              <Card key={t.id.toString()}>
                <CardBody className="space-y-5">
                  {/* Tournament metadata */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-display text-h3 font-medium text-ink">{t.name}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-soft">
                        <Badge variant="outline">Year: {t.year ?? '—'}</Badge>
                        <Badge variant="outline">Format: {t.format ?? '—'}</Badge>
                        <Badge variant="outline">Participants: {t.totalParticipants ?? '—'}</Badge>
                        <Badge variant="outline">Teams: {t.totalTeams ?? '—'}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={publicTournamentUrl(t.sourceUrlRaw)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-1 text-caption text-ink-soft hover:text-primary"
                      >
                        Source <span className="sr-only">for {t.name} (opens in a new tab)</span>
                        <ArrowSquareOut className="h-3 w-3" aria-hidden />
                      </a>
                      {ownUrlByTournament.get(t.id) ? (
                        <ReingestButton url={ownUrlByTournament.get(t.id)!} />
                      ) : null}
                    </div>
                  </div>

                  {warningsByTournamentId.has(t.id) ? (
                    <section className="space-y-2 rounded-md border border-warning/30 bg-warning/6 p-3">
                      <h3 className="text-body font-semibold text-warning">
                        Parser warnings ({warningsByTournamentId.get(t.id)!.length})
                      </h3>
                      <ul className="space-y-1 text-caption text-ink">
                        {warningsByTournamentId.get(t.id)!.map((w, i) => (
                          <li key={i} className="font-mono">
                            {w}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {/*
                    Everything below folds away by default.

                    Expanded, this page measured 41,435px on desktop and
                    129,987px on a phone — 144 screens of parser output, all
                    of it rendered whether or not anyone was checking it.
                    Verify is a page you come to with ONE tournament in mind,
                    so the tournament headers stay visible as an index and
                    the detail opens on demand. Parser warnings stay outside
                    the fold: a warning nobody can see is not a warning.
                  */}
                  {!isSelected ? (
                    <Link
                      href={`/cv/verify?t=${t.id}${mineOnly ? '' : '&mine=0'}`}
                      scroll={false}
                      className="inline-flex min-h-[44px] items-center gap-1.5 text-ui text-ink-soft hover:text-ink"
                    >
                      <CaretDown className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      Show what the parser read
                      <span className="sr-only"> for {t.name}</span>
                      <span className="text-caption">
                        ({participants.length} participant
                        {participants.length === 1 ? '' : 's'} · {t.judgeAssignments.length} judge
                        assignment{t.judgeAssignments.length === 1 ? '' : 's'})
                      </span>
                    </Link>
                  ) : (
                    <div
                      className="space-y-5 outline-hidden"
                      role="region"
                      aria-label={`What the parser read for ${t.name}`}
                    >
                      {/* Arriving here from the "Show what the parser read" link
                          (scroll={false}) unmounts the focused link; move focus
                          to the region it opened (ADM-9). */}
                      {selectedParam ? <FocusOnMount /> : null}

                      {/* Participants */}
                      <section className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="font-display text-ink">
                            Participants {mineOnly ? '(mine only)' : `(${t.participants.length})`}
                          </h3>
                          {mineOnly && participants.length === 0 ? (
                            <span className="text-caption text-ink-soft">
                              No claimed persons for this tournament.
                            </span>
                          ) : null}
                        </div>
                        {/* Desktop: 13-column table. md+ only. */}
                        <div className="hidden max-w-full md:block panel overflow-hidden">
                          <TableScroll>
                            <Table
                              className="min-w-max"
                              label={`Everything the parser read for ${t.name}`}
                            >
                              <thead>
                                <tr>
                                  <Th className="pl-4">Name</Th>
                                  <Th>Roles</Th>
                                  <Th>Team</Th>
                                  <Th numeric>Speaker total</Th>
                                  <Th numeric>Open / ESL / EFL rank</Th>
                                  <Th numeric>Team break rank</Th>
                                  <Th>Broken</Th>
                                  <Th>Last outround spoken</Th>
                                  <Th>Judge tag</Th>
                                  <Th numeric>Inrounds chaired</Th>
                                  <Th>Last outround chaired</Th>
                                  <Th>Last outround judged</Th>
                                  <Th className="pr-4">Per-round scores</Th>
                                </tr>
                              </thead>
                              <tbody>
                                {participants.map((p) => (
                                  <Tr key={p.id.toString()}>
                                    <Td rowHeader className="pl-4">
                                      {displayNameFor(p.person)}
                                      {p.person.claimedByUserId === userId ? (
                                        <Badge variant="success" className="ml-2">
                                          You
                                        </Badge>
                                      ) : null}
                                    </Td>
                                    <Td className="text-ink-soft">
                                      {p.roles.map((r) => r.role).join(', ') || '—'}
                                    </Td>
                                    <Td>{p.teamName ?? '—'}</Td>
                                    <Td numeric>{p.speakerScoreTotal?.toString() ?? '—'}</Td>
                                    <Td numeric>
                                      {p.speakerRankOpen ?? '—'} / {p.speakerRankEsl ?? '—'} /{' '}
                                      {p.speakerRankEfl ?? '—'}
                                    </Td>
                                    <Td numeric>{p.teamBreakRank ?? '—'}</Td>
                                    <Td>
                                      {p.eliminationReached || p.teamBreakRank != null ? (
                                        <Badge variant="success">Yes</Badge>
                                      ) : (
                                        <Badge variant="neutral">No</Badge>
                                      )}
                                    </Td>
                                    <Td>{p.eliminationReached ?? '—'}</Td>
                                    <Td className="text-ink-soft">{p.judgeTypeTag ?? '—'}</Td>
                                    <Td numeric>{p.chairedPrelimRounds ?? '—'}</Td>
                                    <Td>{p.lastOutroundChaired ?? '—'}</Td>
                                    <Td>
                                      {deepestOutroundAcrossRoles(
                                        p.lastOutroundChaired,
                                        p.lastOutroundPaneled,
                                      ) ?? '—'}
                                    </Td>
                                    <Td className="pr-4">
                                      {p.speakerRoundScores.length === 0 ? (
                                        '—'
                                      ) : (
                                        <details>
                                          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-primary hover:underline">
                                            {p.speakerRoundScores.length} rounds
                                          </summary>
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {p.speakerRoundScores.map((s) => (
                                              <span
                                                key={s.id.toString()}
                                                className="rounded border border-border bg-paper px-1.5 py-0.5 font-mono"
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
                                    </Td>
                                  </Tr>
                                ))}
                              </tbody>
                            </Table>
                          </TableScroll>
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
                            ]
                              .filter(Boolean)
                              .join(' · ');
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
                                className="rounded-md border border-border bg-paper p-3 space-y-2.5"
                              >
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <div className="font-medium text-ink">
                                    {displayNameFor(p.person)}
                                    {isYou ? (
                                      <Badge variant="success" className="ml-2">
                                        You
                                      </Badge>
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
                                    <VerifyField label="Broken" value={broke ? 'Yes' : 'No'} />
                                    {p.eliminationReached ? (
                                      <VerifyField
                                        label="Last outround spoken"
                                        value={p.eliminationReached}
                                      />
                                    ) : null}
                                  </dl>
                                ) : null}
                                {hasJudgeData ? (
                                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption border-t border-border pt-2">
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
                                  <details className="text-caption border-t border-border pt-2">
                                    <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-primary hover:underline">
                                      Per-round scores ({p.speakerRoundScores.length})
                                    </summary>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {p.speakerRoundScores.map((s) => (
                                        <span
                                          key={s.id.toString()}
                                          className="rounded border border-border bg-paper px-1.5 py-0.5 font-mono"
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
                        <h3 className="font-display text-ink">
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
                                <span className="font-medium">{displayNameFor(a.person)}</span>
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
                        <h3 className="font-display text-ink">
                          Break results ({t.eliminationResults.length})
                        </h3>
                        {t.eliminationResults.length === 0 ? (
                          <div className="text-caption text-ink-soft">No parsed break rows.</div>
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
                    </div>
                  )}
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
