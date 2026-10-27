import * as React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Trophy, Search, ChevronDown } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import type {
  CvSpeakerRow as SpeakingTableRow,
  CvJudgeRow as JudgingTableRow,
  CvTaggedMotion,
  CvFieldStat,
} from '@/lib/cv/buildCvData';
import {
  formatStageForDisplay,
  formatBaseStageForDisplay,
  championTitle,
} from '@/lib/cv/formatStage';
import { formatAbbrev } from '@/lib/calicotab/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { TableScroll, Table, Th, Td, Tr, Nil } from '@/components/ui/DataTable';
import { CvRowReportButton } from '@/components/CvRowReportButton';
import { AutoScanOnVisit } from '@/components/AutoScanOnVisit';
import { CvNeedsAttentionBanners } from '@/components/CvNeedsAttentionBanners';
import { CvHighlights } from '@/components/CvHighlights';
import { CvShareButton } from '@/components/CvShareButton';
import { CvDownloadButton } from '@/components/CvDownloadButton';
import { GmailDisconnectedNotice } from '@/components/GmailDisconnectedNotice';
import { CvSubNav } from '@/components/CvSubNav';
import {
  TournamentCard,
  TournamentLink,
  type TournamentCardField,
} from '@/components/TournamentCard';
import { pickHeaderMetrics } from '@/lib/cv/headerMetrics';
import { teamTabPlacement, formatTeamTabPlacement } from '@/lib/cv/teamPlacement';
import { hashRank } from '@/lib/cv/rankDisplay';
import {
  bpPlacement,
  cumulativePoints,
  isFourTeamRound,
  ledgerMotions,
  ledgerRoundNames,
} from '@/lib/cv/roundLedger';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = {
  title: 'Record',
  description: 'Your debate tournament history, compiled from your Gmail.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The record view — the product's statement page.
 *
 * Structure follows a bank statement, top to bottom: who the account
 * belongs to, the position summary, then the ledger of transactions with
 * the detail folded away behind each line. Everything on this page is a
 * fact the tab site published; interpretation lives on /cv/stats.
 */
export default async function CvPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  // First-time users without claims belong on /onboarding (the wizard).
  // /cv is the post-onboarding home; we don't want a brand-new user to
  // arrive here and see "No tournaments yet" with no path forward.
  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: userId },
  });
  if (claimedCount === 0) redirect('/onboarding');

  const [data, pendingCount, gmailToken] = await Promise.all([
    buildCvData(userId),
    prisma.ingestJob.count({
      where: { userId, status: { in: ['pending', 'running'] } },
    }),
    // A revoked Gmail grant was only ever surfaced on /dashboard, but
    // AutoScanOnVisit fires here too and swallows the resulting 400 by
    // design. A user who bookmarks /cv — the product's home — would watch
    // their record silently stop updating with nothing on screen to say why.
    prisma.gmailToken.findUnique({ where: { userId }, select: { userId: true } }),
  ]);
  const {
    user,
    speakerRows,
    judgeRows,
    taggedMotions,
    fieldStats,
    unmatchedTournaments: unmatched,
    summary,
    highlights,
  } = data;
  const { totalTournaments, totalRoundsChaired } = summary;

  // Motions by tournament for the per-round ledger. Outround motions carry no
  // round number, so the ledger matches those by stage (ledgerMotions).
  const motionsByTournament = new Map<string, CvTaggedMotion[]>();
  for (const m of taggedMotions) {
    const key = m.tournamentId.toString();
    const list = motionsByTournament.get(key) ?? [];
    list.push(m);
    motionsByTournament.set(key, list);
  }
  const fieldByTournament = new Map(fieldStats.map((f) => [f.tournamentId.toString(), f]));

  const headerMetrics = pickHeaderMetrics({
    totalTournaments,
    breaks: {
      speaking: summary.speakingBreaks,
      judging: summary.judgingBreaks,
      tournamentsSpoken: summary.tournamentsSpoken,
      tournamentsJudged: summary.tournamentsJudged,
    },
    totalRoundsChaired,
    outroundsChaired: highlights.outroundsChaired,
    bestSpeakerRank: highlights.bestSpeakerRank,
    bestSpeakerAverage: highlights.bestSpeakerAverage?.score ?? null,
    speakerCount: speakerRows.length,
    judgeCount: judgeRows.length,
    activeYears: highlights.activeYears,
    deepestBreak: highlights.deepestBreaks[0]?.stage
      ? formatStageForDisplay(highlights.deepestBreaks[0].stage)
      : null,
    bestTeamFinish: highlights.bestTeamFinish,
  });

  // The data's date, not today's: "compiled" used to change on every visit
  // and read as a fact about the record (CV-10).
  const updated = data.lastIngestedAt
    ? data.lastIngestedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <div className="space-y-8">
      {/*
        No Gmail grant, no scan: the request can only 400, and the banner
        below already says what to do. Firing it anyway logged a console
        error on every visit (DASH-13).
      */}
      {gmailToken ? <AutoScanOnVisit /> : null}
      {!gmailToken ? (
        <GmailDisconnectedNotice
          data-print-hide="true"
          action={
            <Link href="/dashboard" className={buttonClasses({ variant: 'primary' })}>
              Reconnect from imports
            </Link>
          }
        >
          New tournaments have stopped arriving. Your record below is still accurate for everything
          already imported.
        </GmailDisconnectedNotice>
      ) : null}
      <CvNeedsAttentionBanners pendingCount={pendingCount} unmatchedCount={unmatched.length} />

      {/* Account header — identity on the left, statement actions on the
          right, exactly where a banking dashboard puts them. */}
      <header className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="data-label">Debate record{updated ? ` · updated ${updated}` : ''}</div>
          <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
            <span className="sr-only">Debate record of </span>
            {user?.name ?? 'Debater'}
          </h1>
          <p className="mt-1.5 text-table text-ink-soft">
            {[
              user?.email,
              highlights.activeYears
                ? highlights.activeYears.from === highlights.activeYears.to
                  ? `Active ${highlights.activeYears.from}`
                  : `Active ${highlights.activeYears.from}–${highlights.activeYears.to}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-print-hide="true">
          <CvShareButton />
          <CvDownloadButton />
        </div>
      </header>

      {headerMetrics.length > 0 ? (
        <StatRow>
          {headerMetrics.map((m) => (
            <StatTile
              key={m.label}
              label={m.label}
              value={m.value}
              hint={m.hint}
              accent={m.accent}
            />
          ))}
        </StatRow>
      ) : null}

      <CvSubNav active="record" />

      {totalTournaments === 0 ? (
        <EmptyState
          icon={<Trophy className="h-5 w-5" aria-hidden />}
          title="No tournaments ingested yet"
          description={
            <>
              Two steps from Imports: <strong>Scan Gmail</strong> finds the tournament links, then{' '}
              <strong>Ingest all</strong> parses each one. Your record populates here as they
              finish.
            </>
          }
          // The disconnect notice above already carries the one primary to
          // /dashboard; a second identical one made two (NV-16).
          action={
            gmailToken ? (
              <Link href="/dashboard" className={buttonClasses({ variant: 'primary' })}>
                <Search className="h-4 w-4" aria-hidden /> Open imports
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <CvHighlights highlights={highlights} />

          {speakerRows.length > 0 ? (
            <section aria-label="Speaking" className="space-y-3">
              <SectionHeader
                label="Speaking"
                title={`${speakerRows.length} tournament${speakerRows.length === 1 ? '' : 's'}`}
                meta="Expand a row for the round-by-round ledger"
              />
              <SpeakingTable
                rows={speakerRows}
                motionsByTournament={motionsByTournament}
                fieldByTournament={fieldByTournament}
              />
              {/*
                The abbreviated column headers explain themselves through
                `title`, which needs a hover. A tablet gets this same desktop
                table and has no pointer, so the explanation was unreachable
                on exactly the devices that most need it. Visible on the
                table breakpoint only — the mobile cards spell the labels out
                in full already.
              */}
              <p className="hidden text-caption text-ink-soft md:block">
                <span className="font-medium text-ink">Team rank</span> is where your team finished
                on the prelim team tab, out of how many teams (#3/40 is third of forty) — your
                placement. <span className="font-medium text-ink">Spk avg</span> is your speaker
                score per prelim round. <span className="font-medium text-ink">Spk tab</span> is
                where that average placed among every speaker on the speaker tab.{' '}
                <span className="font-medium text-ink">Spk rank</span> is the speaker tab&rsquo;s
                own rank within each break category — Open, ESL (English as Second Language) and EFL
                (English as Foreign Language).
              </p>
            </section>
          ) : null}

          {judgeRows.length > 0 ? (
            <section aria-label="Judging" className="space-y-3">
              <SectionHeader
                label="Judging"
                title={`${judgeRows.length} tournament${judgeRows.length === 1 ? '' : 's'}`}
              />
              <JudgingTable rows={judgeRows} />
            </section>
          ) : null}

          {/*
            Unmatched tournaments are surfaced via CvNeedsAttentionBanners at
            the top of the page; the per-row Find-me search lives on the
            imports page's Unmatched filter.
          */}
        </>
      )}
    </div>
  );
}

/**
 * Hover text for the team-rank cell: "3 of 40 teams · top 8%", the team's
 * placement against the team tab. Falls back to the bare rank when the field
 * size is unknown or inconsistent with it.
 */
function teamPlacementTitle(r: {
  teamRank: number | null;
  teamRankTied?: boolean;
  totalTeams: number | null;
}): string | undefined {
  const p = teamTabPlacement(r.teamRank, r.totalTeams);
  return p ? `${formatTeamTabPlacement(p, r.teamRankTied)} on the prelim team tab` : undefined;
}

// Pretty-print speaker rank columns: "#5 Open · #3 ESL"; a tied Open rank reads "#5=".
function fmtSpeakerRanks(r: {
  speakerRankOpen: number | null;
  speakerRankTied?: boolean;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
}): string | null {
  const parts: string[] = [];
  if (r.speakerRankOpen != null)
    parts.push(`${hashRank(r.speakerRankOpen, r.speakerRankTied)} Open`);
  if (r.speakerRankEsl != null) parts.push(`#${r.speakerRankEsl} ESL`);
  if (r.speakerRankEfl != null) parts.push(`#${r.speakerRankEfl} EFL`);
  return parts.join(' · ') || null;
}

function fmtLastOutroundSpoken(r: SpeakingTableRow): string | null {
  // Show the actual outround stage (Quarterfinals, Semifinals, …) when we
  // have it. The break-tab rank lives in its own column; conflating "made
  // the break tab" with "spoke in an outround" misleads — a team can appear
  // on the break tab but lose in their first outround room. When the team
  // won the final, append "(Champion)" so winners read distinctly from
  // grand-finalists. EUDC dual-break: render the deepest outround per
  // category together, e.g. "Open: Octofinals · ESL: Grand Final".
  if (r.eliminationReachedByCategory && r.eliminationReachedByCategory.length > 1) {
    const joined = r.eliminationReachedByCategory
      .map((e) => `${e.category}: ${formatBaseStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (${championTitle(r.eliminationReached)})` : joined;
  }
  if (!r.eliminationReached) return null;
  const display = formatStageForDisplay(r.eliminationReached);
  if (r.wonTournament === true) return `${display} (${championTitle(r.eliminationReached)})`;
  return display;
}

function ReportCell({
  r,
  compact = false,
}: {
  r: { tournamentId: bigint; tournamentName: string; hasOpenReport: boolean };
  compact?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5" data-print-hide="true">
      {/* Plain visible text, not a live region: the badge is a fact about
          the row present at load, not a status change (UX-19). */}
      {r.hasOpenReport ? <Badge variant="warning">Reported</Badge> : null}
      <CvRowReportButton
        tournamentId={r.tournamentId.toString()}
        tournamentName={r.tournamentName}
        iconOnly={compact}
      />
    </div>
  );
}

/**
 * The per-round ledger behind a tournament row: one line per round with the
 * side debated, the motion released for it, the speaker score and the team
 * result. This is the detail the product scrapes and, until this rebuild,
 * never showed — a speaker score without its motion and side is a number
 * with no story attached.
 *
 * Native <details> so it works without client JS and prints expanded.
 */
function RoundLedger({
  r,
  motionsByTournament,
  className,
}: {
  r: SpeakingTableRow;
  motionsByTournament: Map<string, CvTaggedMotion[]>;
  className?: string;
}) {
  const scoreByRound = new Map(r.roundScores.map((s) => [s.roundNumber, s]));
  const resultByRound = new Map(r.teamRoundResults.map((t) => [t.roundNumber, t]));
  const roundNumbers = [...new Set([...scoreByRound.keys(), ...resultByRound.keys()])].sort(
    (a, b) => a - b,
  );
  if (roundNumbers.length === 0) return null;

  // "Round 7" / "Quarterfinals", not "R7"; points as a running total; and a
  // four-team (BP) room shows a placement, since nobody "wins" it outright.
  const roundNames = ledgerRoundNames({
    roundNumbers,
    prelimRoundCount: r.prelimRoundCount,
    eliminationReached: r.eliminationReached,
  });
  const motionsByRound = ledgerMotions({
    roundNumbers,
    roundNames,
    prelimRoundCount: r.prelimRoundCount,
    eliminationReached: r.eliminationReached,
    multiCategoryRun: (r.eliminationReachedByCategory?.length ?? 0) > 1,
    motions: motionsByTournament.get(r.tournamentId.toString()) ?? [],
  });
  const anyMotion = roundNumbers.some((n) => (motionsByRound.get(n) ?? []).length > 0);
  const totalPoints = cumulativePoints(r.teamRoundResults);

  return (
    <details className={cn('group', className)}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 py-2 text-caption text-ink-soft hover:text-ink">
        <ChevronDown
          className="h-3.5 w-3.5 text-primary transition-transform group-open:rotate-180"
          aria-hidden
        />
        Round ledger — {roundNumbers.length} round{roundNumbers.length === 1 ? '' : 's'}
        {anyMotion ? ' with motions' : ''}
      </summary>
      <div className="panel-inset mb-3 p-3">
        <TableScroll>
          <Table className="text-caption" label={`Round-by-round ledger for ${r.tournamentName}`}>
            <thead>
              <tr>
                <Th>Round</Th>
                <Th>Side</Th>
                {anyMotion ? <Th>Motion</Th> : null}
                <Th numeric>Score</Th>
                <Th numeric title="Team points after this round (running total)">
                  Pts
                </Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {roundNumbers.map((n) => {
                const score = scoreByRound.get(n);
                const result = resultByRound.get(n);
                const motions = motionsByRound.get(n) ?? [];
                const placement = isFourTeamRound({
                  position: result?.position ?? null,
                  format: r.format,
                })
                  ? bpPlacement(result?.points ?? null)
                  : null;
                return (
                  <tr key={n}>
                    <Td className="whitespace-nowrap">{roundNames.get(n) ?? `Round ${n}`}</Td>
                    <Td className="whitespace-nowrap text-ink-soft">
                      {result?.position ?? <Nil />}
                    </Td>
                    {anyMotion ? (
                      <Td className="text-ink-soft">
                        {motions.length === 0 ? (
                          <Nil title="No motion released for this round" />
                        ) : (
                          // Every motion on its own line. A round with two
                          // motions used to show the first and park the rest
                          // in a hover-only title, which touch never shows
                          // (CV-9). The width cap sits on the inner block
                          // because browsers ignore max-width on a table cell.
                          <span className="block max-w-[32rem] space-y-1">
                            {motions.map((m, i) => (
                              <span key={i} className="block">
                                {m.text}
                              </span>
                            ))}
                          </span>
                        )}
                      </Td>
                    ) : null}
                    <Td numeric>{score?.score != null ? score.score.toFixed(1) : <Nil />}</Td>
                    <Td numeric>{totalPoints.has(n) ? totalPoints.get(n) : <Nil />}</Td>
                    <Td className="whitespace-nowrap">
                      {isFourTeamRound({ position: result?.position ?? null, format: r.format }) ? (
                        // A BP room has four teams and no winner: show where the
                        // team placed. Colour only the ends, as elsewhere —
                        // colour on a number means up or down.
                        placement ? (
                          <span
                            className={
                              placement === '1st'
                                ? 'val-pos font-medium'
                                : placement === '4th'
                                  ? 'val-neg'
                                  : undefined
                            }
                          >
                            {placement}
                          </span>
                        ) : (
                          <Nil />
                        )
                      ) : result?.won == null ? (
                        <Nil />
                      ) : result.won ? (
                        <span className="val-pos font-medium">Won</span>
                      ) : (
                        <span className="val-neg">Lost</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </div>
    </details>
  );
}

function SpeakingTable({
  rows,
  motionsByTournament,
  fieldByTournament,
}: {
  rows: SpeakingTableRow[];
  motionsByTournament: Map<string, CvTaggedMotion[]>;
  fieldByTournament: Map<string, CvFieldStat>;
}) {
  return (
    <>
      {/* Desktop ledger */}
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full" label="Speaking record by tournament">
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th numeric>Year</Th>
                <Th>Format</Th>
                <Th>Team</Th>
                <Th
                  numeric
                  title="Where the team finished on the prelim team tab, of how many teams"
                >
                  Team rank
                </Th>
                <Th numeric>Pts</Th>
                <Th numeric title="Average speaker score per prelim round spoken">
                  Spk avg
                </Th>
                <Th
                  numeric
                  title="Where that average placed among every speaker on the speaker tab — an individual figure, not the team's placement"
                >
                  Spk tab
                </Th>
                <Th title="Speaker rank within each break category. Open = main draw; ESL = English as Second Language; EFL = English as Foreign Language.">
                  Spk rank
                </Th>
                <Th>Result</Th>
                <Th className="pr-4">
                  <span className="sr-only">Report a problem</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const field = fieldByTournament.get(r.tournamentId.toString());
                const outround = fmtLastOutroundSpoken(r);
                const ranks = fmtSpeakerRanks(r);
                const hasRoundDetail = r.roundScores.length > 0 || r.teamRoundResults.length > 0;
                return (
                  <React.Fragment key={r.tournamentId.toString()}>
                    <Tr className="align-top">
                      <Td className="pl-4">
                        <TournamentCell
                          name={r.tournamentName}
                          href={r.sourceUrl}
                          myName={r.myName}
                        />
                      </Td>
                      <Td numeric className="text-ink-soft">
                        {r.year ?? <Nil />}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                        {formatAbbrev(r.format) ?? <Nil />}
                      </Td>
                      {/*
                      Team and partner share one column, and the field size
                      rides on the rank ("#3/40") instead of a Teams column of
                      its own. Those two columns were the ledger's overflow
                      at 1280 px (CV-2), and both truncated their text behind
                      a hover-only title (UX-36). The cap sits on the inner
                      block because a table cell ignores max-width.
                    */}
                      <Td>
                        <div className="max-w-[13rem] break-words">
                          {r.teamName ?? <Nil />}
                          {r.teammates.length ? (
                            <div className="text-caption text-ink-soft">
                              with {r.teammates.join(', ')}
                            </div>
                          ) : null}
                        </div>
                      </Td>
                      <Td numeric className="whitespace-nowrap">
                        {r.teamRank != null ? (
                          <span title={teamPlacementTitle(r)}>
                            {hashRank(r.teamRank, r.teamRankTied)}
                            {r.totalTeams != null ? (
                              <span className="text-ink-soft">/{r.totalTeams}</span>
                            ) : null}
                          </span>
                        ) : (
                          <Nil />
                        )}
                      </Td>
                      <Td numeric>
                        {r.teamPoints ?? (r.teamWins != null ? `${r.teamWins}W` : <Nil />)}
                      </Td>
                      <Td
                        numeric
                        title={
                          r.speakerAvgScore && r.prelimsSpoken > 0
                            ? `Average across ${r.prelimsSpoken} prelim ${r.prelimsSpoken === 1 ? 'round' : 'rounds'}`
                            : undefined
                        }
                      >
                        {r.speakerAvgScore ?? <Nil />}
                      </Td>
                      <Td numeric className="text-ink-soft">
                        {field?.betterThanUser != null && field.speakerCount > 0 ? (
                          <span
                            title={`${field.betterThanUser + 1} of ${field.speakerCount} speakers on the speaker tab`}
                          >
                            {field.betterThanUser + 1}/{field.speakerCount}
                          </span>
                        ) : (
                          <Nil title="Speaker tab did not publish comparable totals" />
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{ranks ?? <Nil />}</Td>
                      {/*
                      A "Broke" badge next to "Quarterfinals" says the same
                      thing twice — reaching an outround IS the break — and
                      the pair was the widest column on the ledger. The gold
                      badge is what carries the break visually, so the label
                      moves inside it instead of sitting beside it.
                    */}
                      <Td className="whitespace-nowrap">
                        {r.broke ? (
                          <Badge variant="gold">{outround ?? 'Broke'}</Badge>
                        ) : outround ? (
                          <span className="text-ink">{outround}</span>
                        ) : (
                          <Nil />
                        )}
                      </Td>
                      <Td className="pr-4">
                        <ReportCell r={r} compact />
                      </Td>
                    </Tr>
                    {/*
                    The round ledger gets its own full-width row rather than
                    living inside the Tournament cell. Nested in a cell, the
                    long motion column forces that column wide and blows the
                    whole ledger's geometry apart — and the print stylesheet
                    forces <details> open, so it would do it on paper too.
                  */}
                    {hasRoundDetail ? (
                      <tr className="border-b border-border">
                        <td colSpan={SPEAKING_COLUMNS} className="px-4 py-0">
                          <RoundLedger r={r} motionsByTournament={motionsByTournament} />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      {/* Mobile: one panel per tournament. An eleven-column ledger cannot be
          squeezed onto a phone, so the same fields become a labelled grid. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <TournamentCard
            key={r.tournamentId.toString()}
            name={r.tournamentName}
            href={r.sourceUrl}
            year={r.year}
            result={breakResult(r.broke, fmtLastOutroundSpoken(r))}
            fields={speakerCardFields(r, fieldByTournament.get(r.tournamentId.toString()))}
          >
            <RoundLedger r={r} motionsByTournament={motionsByTournament} />
            <ReportCell r={r} />
          </TournamentCard>
        ))}
      </ul>
    </>
  );
}

function JudgingTable({ rows }: { rows: JudgingTableRow[] }) {
  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full" label="Judging record by tournament">
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th numeric>Year</Th>
                <Th>Format</Th>
                <Th numeric>Teams</Th>
                <Th>Judge type</Th>
                <Th numeric>Judged</Th>
                <Th numeric>Chaired</Th>
                <Th>Last outround chaired</Th>
                <Th>Last outround judged</Th>
                <Th className="pr-4">
                  <span className="sr-only">Report a problem</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.tournamentId.toString()}>
                  <Td className="pl-4">
                    <TournamentCell name={r.tournamentName} href={r.sourceUrl} myName={r.myName} />
                  </Td>
                  <Td numeric className="text-ink-soft">
                    {r.year ?? <Nil />}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                    {formatAbbrev(r.format) ?? <Nil />}
                  </Td>
                  <Td numeric className="text-ink-soft">
                    {r.totalTeams ?? <Nil />}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">{r.judgeTypeTag ?? <Nil />}</Td>
                  <Td numeric>{r.inroundsJudged ?? <Nil />}</Td>
                  <Td numeric>{r.inroundsChaired ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap">
                    {r.lastOutroundChaired ? (
                      <span className="flex items-center gap-1.5">
                        {r.broke ? <Badge variant="gold">Broke</Badge> : null}
                        {formatStageForDisplay(r.lastOutroundChaired)}
                      </span>
                    ) : r.broke ? (
                      <Badge variant="gold">Broke</Badge>
                    ) : (
                      <Nil />
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatStageForDisplay(r.lastOutroundJudged) || <Nil />}
                  </Td>
                  <Td className="pr-4">
                    <ReportCell r={r} compact />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <TournamentCard
            key={r.tournamentId.toString()}
            name={r.tournamentName}
            href={r.sourceUrl}
            year={r.year}
            result={r.broke ? <Badge variant="gold">Broke</Badge> : null}
            fields={judgeCardFields(r)}
          >
            <ReportCell r={r} />
          </TournamentCard>
        ))}
      </ul>
    </>
  );
}

const SPEAKING_COLUMNS = 11;

/**
 * The ledger's first column: the tournament, linked out to its tab, and the
 * name the tab printed for the user underneath. The name wraps inside a
 * 16rem block instead of truncating behind a hover title (UX-36).
 */
function TournamentCell({ name, href, myName }: { name: string; href: string; myName: string }) {
  return (
    <div className="max-w-[16rem]">
      <TournamentLink name={name} href={href} className="coarse:min-h-[44px]" />
      <div className="text-caption text-ink-soft">{myName}</div>
    </div>
  );
}

/**
 * The result line on a speaking card. Reaching an outround is the break, so
 * the stage goes inside the gold badge rather than beside a second "Broke"
 * badge, exactly as the desktop Result column has it (CV-8).
 */
function breakResult(broke: boolean, outround: string | null): React.ReactNode {
  if (broke) return <Badge variant="gold">{outround ?? 'Broke'}</Badge>;
  return outround ? <span className="text-caption text-ink">{outround}</span> : null;
}

/** A speaking row's columns as labelled card fields, most telling first. */
function speakerCardFields(
  r: SpeakingTableRow,
  field: CvFieldStat | undefined,
): TournamentCardField[] {
  const ranks = fmtSpeakerRanks(r);
  const out: TournamentCardField[] = [];
  if (r.speakerAvgScore) out.push({ label: 'Speaker avg', value: r.speakerAvgScore, mono: true });
  if (field?.betterThanUser != null && field.speakerCount > 0) {
    out.push({
      label: 'Speaker tab',
      value: `${field.betterThanUser + 1} of ${field.speakerCount}`,
      mono: true,
    });
  }
  if (r.teamRank != null) {
    out.push({
      label: 'Team rank',
      value:
        r.totalTeams != null
          ? `${hashRank(r.teamRank, r.teamRankTied)} of ${r.totalTeams}`
          : hashRank(r.teamRank, r.teamRankTied),
      mono: true,
    });
  }
  if (r.teamPoints) out.push({ label: 'Team points', value: r.teamPoints, mono: true });
  if (ranks) out.push({ label: 'Speaker-tab rank', value: ranks });
  if (r.format) out.push({ label: 'Format', value: r.format });
  if (r.teamName) out.push({ label: 'Team', value: r.teamName });
  if (r.teammates.length) out.push({ label: 'Partner', value: r.teammates.join(', ') });
  return out;
}

function judgeCardFields(r: JudgingTableRow): TournamentCardField[] {
  const out: TournamentCardField[] = [];
  if (r.judgeTypeTag) out.push({ label: 'Judge type', value: r.judgeTypeTag });
  out.push({
    label: 'Inrounds judged',
    value: r.inroundsJudged != null ? String(r.inroundsJudged) : '—',
    mono: true,
  });
  out.push({
    label: 'Inrounds chaired',
    value: r.inroundsChaired != null ? String(r.inroundsChaired) : '—',
    mono: true,
  });
  if (r.format) out.push({ label: 'Format', value: r.format });
  if (r.lastOutroundChaired) {
    out.push({
      label: 'Last outround chaired',
      value: formatStageForDisplay(r.lastOutroundChaired),
    });
  }
  if (r.lastOutroundJudged) {
    out.push({ label: 'Last outround judged', value: formatStageForDisplay(r.lastOutroundJudged) });
  }
  return out;
}
