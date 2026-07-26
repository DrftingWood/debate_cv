import * as React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Trophy, Search, ChevronDown, ExternalLink } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import type {
  CvSpeakerRow as SpeakingTableRow,
  CvJudgeRow as JudgingTableRow,
  CvTaggedMotion,
  CvFieldStat,
} from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { formatAbbrev } from '@/lib/calicotab/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
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
import { CvSubNav } from '@/components/CvSubNav';
import { pickHeaderMetrics } from '@/lib/cv/headerMetrics';
import { computeSpeakerStats } from '@/lib/cv/speakerStats';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = {
  title: 'My CV',
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
  const { totalTournaments, breaks, totalRoundsChaired } = summary;

  // Motions keyed by tournament + round for the per-round detail strips.
  const motionsByRound = new Map<string, CvTaggedMotion[]>();
  for (const m of taggedMotions) {
    if (m.roundNumber == null) continue;
    const key = `${m.tournamentId}:${m.roundNumber}`;
    const list = motionsByRound.get(key) ?? [];
    list.push(m);
    motionsByRound.set(key, list);
  }
  const fieldByTournament = new Map(fieldStats.map((f) => [f.tournamentId.toString(), f]));

  // Pure in-memory pass over rows already loaded above — no extra queries.
  // Sharing the computation with /u and /cv/stats is the point: all three
  // surfaces must print the same career average, to the same decimal.
  const scoreProfile = computeSpeakerStats(data).scoreProfile;

  const headerMetrics = pickHeaderMetrics({
    totalTournaments,
    breaks,
    totalRoundsChaired,
    outroundsChaired: highlights.outroundsChaired,
    careerSpeakerAverage: scoreProfile.mean,
    scoredSpeeches: scoreProfile.speeches,
    speakerCount: speakerRows.length,
    judgeCount: judgeRows.length,
    activeYears: highlights.activeYears,
  });

  const compiled = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="space-y-8">
      <AutoScanOnVisit />
      {!gmailToken ? (
        <section
          aria-label="Gmail disconnected"
          data-print-hide="true"
          className="flex flex-col gap-3 rounded-card border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.06)] p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="data-label text-warning">Gmail disconnected</div>
            <p className="mt-1 text-table text-ink">
              New tournaments have stopped arriving. Your record below is still accurate for
              everything already imported.
            </p>
          </div>
          <Link href="/dashboard">
            <Button variant="primary">Reconnect from imports</Button>
          </Link>
        </section>
      ) : null}
      <CvNeedsAttentionBanners
        pendingCount={pendingCount}
        unmatchedCount={unmatched.length}
      />

      {/* Account header — identity on the left, statement actions on the
          right, exactly where a banking dashboard puts them. */}
      <header className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="data-label">Debate record · compiled {compiled}</div>
          <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
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
              Two steps from Imports: <strong>Scan Gmail</strong> finds the tournament links,
              then <strong>Ingest all</strong> parses each one. Your record populates here as
              they finish.
            </>
          }
          action={
            <Link href="/dashboard">
              <Button variant="primary" leftIcon={<Search className="h-4 w-4" aria-hidden />}>
                Open imports
              </Button>
            </Link>
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
                motionsByRound={motionsByRound}
                fieldByTournament={fieldByTournament}
                accountName={user?.name ?? null}
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
                <span className="font-medium text-ink">Spk avg</span> is your speaker score per
                prelim round. <span className="font-medium text-ink">Field</span> is where that
                average placed among every speaker on the tab.{' '}
                <span className="font-medium text-ink">Spk rank</span> is the tab&rsquo;s own rank
                within each break category — Open, ESL (English as Second Language) and EFL
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
              <JudgingTable rows={judgeRows} accountName={user?.name ?? null} />
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

// Pretty-print speaker rank columns: "#5 Open · #3 ESL"
function fmtSpeakerRanks(r: {
  speakerRankOpen: number | null;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
}): string | null {
  const parts: string[] = [];
  if (r.speakerRankOpen != null) parts.push(`#${r.speakerRankOpen} Open`);
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
      .map((e) => `${e.category}: ${formatStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (Champion)` : joined;
  }
  if (!r.eliminationReached) return null;
  const display = formatStageForDisplay(r.eliminationReached);
  if (r.wonTournament === true) return `${display} (Champion)`;
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
      {r.hasOpenReport ? (
        <Badge variant="warning" role="status" aria-label="Open report against this tournament">
          Reported
        </Badge>
      ) : null}
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
  motionsByRound,
  className,
}: {
  r: SpeakingTableRow;
  motionsByRound: Map<string, CvTaggedMotion[]>;
  className?: string;
}) {
  const scoreByRound = new Map(r.roundScores.map((s) => [s.roundNumber, s]));
  const resultByRound = new Map(r.teamRoundResults.map((t) => [t.roundNumber, t]));
  const roundNumbers = [...new Set([...scoreByRound.keys(), ...resultByRound.keys()])].sort(
    (a, b) => a - b,
  );
  if (roundNumbers.length === 0) return null;

  const anyMotion = roundNumbers.some(
    (n) => (motionsByRound.get(`${r.tournamentId}:${n}`) ?? []).length > 0,
  );

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
      <div className="panel-inset mb-3 overflow-x-auto p-3">
        <Table className="text-caption" label={`Round-by-round ledger for ${r.tournamentName}`}>
          <thead>
            <tr>
              <Th>Round</Th>
              <Th>Side</Th>
              {anyMotion ? <Th>Motion</Th> : null}
              <Th numeric>Score</Th>
              <Th numeric>Pts</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {roundNumbers.map((n) => {
              const score = scoreByRound.get(n);
              const result = resultByRound.get(n);
              const motions = motionsByRound.get(`${r.tournamentId}:${n}`) ?? [];
              return (
                <tr key={n}>
                  <Td className="num whitespace-nowrap">R{n}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{result?.position ?? <Nil />}</Td>
                  {anyMotion ? (
                    <Td className="max-w-[32rem] text-ink-soft">
                      {motions.length === 0 ? (
                        <Nil title="No motion released for this round" />
                      ) : (
                        <span title={motions.map((m) => m.text).join('\n\n')}>
                          {motions[0].text}
                          {motions.length > 1 ? (
                            <span className="ml-1 text-ink-soft">
                              (+{motions.length - 1} more this round)
                            </span>
                          ) : null}
                        </span>
                      )}
                    </Td>
                  ) : null}
                  <Td numeric>
                    {score?.score != null ? score.score.toFixed(1) : <Nil />}
                  </Td>
                  <Td numeric>{result?.points != null ? result.points : <Nil />}</Td>
                  <Td className="whitespace-nowrap">
                    {result?.won == null ? (
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
      </div>
    </details>
  );
}

function SpeakingTable({
  rows,
  motionsByRound,
  fieldByTournament,
  accountName,
}: {
  rows: SpeakingTableRow[];
  motionsByRound: Map<string, CvTaggedMotion[]>;
  fieldByTournament: Map<string, CvFieldStat>;
  /** The name on the account, so a row can suppress a matching alias. */
  accountName: string | null;
}) {
  return (
    <>
      {/* Desktop ledger */}
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="min-w-max" label="Speaking record by tournament">
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th numeric>Year</Th>
                <Th>Format</Th>
                <Th numeric>Teams</Th>
                <Th>Team</Th>
                <Th>Partner</Th>
                <Th numeric title="Where the team finished on the team tab">Rank</Th>
                <Th numeric>Pts</Th>
                <Th numeric title="Average speaker score per prelim round spoken">
                  Spk avg
                </Th>
                <Th numeric title="Where that average placed among every speaker on the tab">
                  Field
                </Th>
                <Th title="Speaker rank within each break category. Open = main draw; ESL = English as Second Language; EFL = English as Foreign Language.">
                  Spk rank
                </Th>
                <Th>Result</Th>
                <Th className="pr-4" aria-label="Report" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const field = fieldByTournament.get(r.tournamentId.toString());
                const outround = fmtLastOutroundSpoken(r);
                const ranks = fmtSpeakerRanks(r);
                const hasRoundDetail =
                  r.roundScores.length > 0 || r.teamRoundResults.length > 0;
                return (
                  <React.Fragment key={r.tournamentId.toString()}>
                  <Tr className="align-top">
                    <Td className="pl-4">
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex min-h-[44px] max-w-[16rem] items-center gap-1 truncate font-medium text-ink hover:text-primary"
                        title={r.tournamentName}
                      >
                        <span className="truncate">{r.tournamentName}</span>
                        <ExternalLink
                          className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                          aria-hidden
                        />
                      </a>
                      {/*
                        The registration name only when it is NOT the name
                        already at the top of the page. It earns its line
                        when a tournament registered you as "M. Rao" and you
                        need to see which alias matched; printed on every row
                        it was the account holder's own name repeated once
                        per tournament, directly under an h1 saying it.
                      */}
                      {aliasNote(r.myName, accountName) ? (
                        <div className="text-caption text-ink-soft">{r.myName}</div>
                      ) : null}
                    </Td>
                    <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                    <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                      {formatAbbrev(r.format) ?? <Nil />}
                    </Td>
                    <Td numeric className="text-ink-soft">{r.totalTeams ?? <Nil />}</Td>
                    <Td className="max-w-[10rem] truncate" title={r.teamName ?? undefined}>
                      {r.teamName ?? <Nil />}
                    </Td>
                    <Td
                      className="max-w-[10rem] truncate text-ink-soft"
                      title={r.teammates.join(', ')}
                    >
                      {r.teammates.length ? r.teammates.join(', ') : <Nil />}
                    </Td>
                    <Td numeric>{r.teamRank != null ? `#${r.teamRank}` : <Nil />}</Td>
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
                          title={`${field.betterThanUser + 1} of ${field.speakerCount} speakers on the tab`}
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
                      <td colSpan={13} className="px-4 py-0">
                        <RoundLedger r={r} motionsByRound={motionsByRound} />
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

      {/* Mobile: one panel per tournament. A 13-column ledger cannot be
          squeezed onto a phone, so the same fields become a labelled grid. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => {
          const field = fieldByTournament.get(r.tournamentId.toString());
          const outround = fmtLastOutroundSpoken(r);
          const ranks = fmtSpeakerRanks(r);
          return (
            <li key={r.tournamentId.toString()} className="panel p-4">
              <div className="flex items-baseline justify-between gap-2">
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  // py-1 is a tap target, not spacing. At the bare
                  // line-height these titles were 23px tall — under the 24px
                  // WCAG 2.2 minimum, and they are the only way into the
                  // source tab from a phone.
                  className="inline-block truncate py-1 font-display text-h4 font-medium text-ink"
                >
                  {r.tournamentName}
                </a>
                <span className="num shrink-0 text-caption text-ink-soft">{r.year ?? '—'}</span>
              </div>
              {r.broke || outround ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {r.broke ? <Badge variant="gold">Broke</Badge> : null}
                  {outround ? <span className="text-caption text-ink">{outround}</span> : null}
                </div>
              ) : null}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                {r.speakerAvgScore ? <Field label="Speaker avg" value={r.speakerAvgScore} mono /> : null}
                {field?.betterThanUser != null && field.speakerCount > 0 ? (
                  <Field
                    label="On the tab"
                    value={`${field.betterThanUser + 1} of ${field.speakerCount}`}
                    mono
                  />
                ) : null}
                {r.teamRank != null ? <Field label="Team rank" value={`#${r.teamRank}`} mono /> : null}
                {r.teamPoints ? <Field label="Team points" value={r.teamPoints} mono /> : null}
                {ranks ? <Field label="Speaker rank" value={ranks} /> : null}
                {r.format ? <Field label="Format" value={r.format} /> : null}
                {r.totalTeams != null ? <Field label="Teams" value={String(r.totalTeams)} mono /> : null}
                {r.teamName ? <Field label="Team" value={r.teamName} /> : null}
                {r.teammates.length ? <Field label="Partner" value={r.teammates.join(', ')} /> : null}
              </dl>
              <RoundLedger r={r} motionsByRound={motionsByRound} />
              <ReportCell r={r} />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function JudgingTable({
  rows,
  accountName,
}: {
  rows: JudgingTableRow[];
  accountName: string | null;
}) {
  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="min-w-max" label="Judging record by tournament">
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
                <Th className="pr-4" aria-label="Report" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.tournamentId.toString()}>
                  <Td className="pl-4">
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block max-w-[16rem] truncate font-medium text-ink hover:text-primary"
                      title={r.tournamentName}
                    >
                      {r.tournamentName}
                    </a>
                    {aliasNote(r.myName, accountName) ? (
                      <div className="text-caption text-ink-soft">{r.myName}</div>
                    ) : null}
                  </Td>
                  <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                    {formatAbbrev(r.format) ?? <Nil />}
                  </Td>
                  <Td numeric className="text-ink-soft">{r.totalTeams ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">
                    {r.judgeTypeTag ?? <Nil />}
                  </Td>
                  <Td numeric>{r.inroundsJudged ?? <Nil />}</Td>
                  <Td numeric>{r.inroundsChaired ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap">
                    {r.lastOutroundChaired ? (
                      <span className="flex items-center gap-1.5">
                        {r.broke ? <Badge variant="gold">Broke</Badge> : null}
                        {r.lastOutroundChaired}
                      </span>
                    ) : r.broke ? (
                      <Badge variant="gold">Broke</Badge>
                    ) : (
                      <Nil />
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{r.lastOutroundJudged ?? <Nil />}</Td>
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
          <li key={r.tournamentId.toString()} className="panel p-4">
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block truncate py-1 font-display text-h4 font-medium text-ink"
              >
                {r.tournamentName}
              </a>
              <span className="num shrink-0 text-caption text-ink-soft">{r.year ?? '—'}</span>
            </div>
            {r.broke ? (
              <div className="mt-2">
                <Badge variant="gold">Broke</Badge>
              </div>
            ) : null}
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
              {r.judgeTypeTag ? <Field label="Judge type" value={r.judgeTypeTag} /> : null}
              <Field
                label="Inrounds judged"
                value={r.inroundsJudged != null ? String(r.inroundsJudged) : '—'}
                mono
              />
              <Field
                label="Inrounds chaired"
                value={r.inroundsChaired != null ? String(r.inroundsChaired) : '—'}
                mono
              />
              {r.format ? <Field label="Format" value={r.format} /> : null}
              {r.lastOutroundChaired ? (
                <Field label="Last outround chaired" value={r.lastOutroundChaired} />
              ) : null}
              {r.lastOutroundJudged ? (
                <Field label="Last outround judged" value={r.lastOutroundJudged} />
              ) : null}
            </dl>
            <ReportCell r={r} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * True when a row's matched registration name says something the page
 * header does not. Compared case- and punctuation-insensitively so
 * "maya rao" and "Maya Rao" don't count as different spellings.
 */
function aliasNote(rowName: string | null, accountName: string | null): boolean {
  if (!rowName) return false;
  if (!accountName) return true;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(rowName) !== norm(accountName);
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="data-label truncate">{label}</dt>
      <dd className={'mt-0.5 truncate text-table text-ink ' + (mono ? 'num' : '')} title={value}>
        {value}
      </dd>
    </div>
  );
}
