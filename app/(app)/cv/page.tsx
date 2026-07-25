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

  const [data, pendingCount] = await Promise.all([
    buildCvData(userId),
    prisma.ingestJob.count({
      where: { userId, status: { in: ['pending', 'running'] } },
    }),
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

  const headerMetrics = pickHeaderMetrics({
    totalTournaments,
    breaks,
    totalRoundsChaired,
    outroundsChaired: highlights.outroundsChaired,
    bestSpeakerRank: highlights.bestSpeakerRank?.rank ?? null,
    bestSpeakerAverage: highlights.bestSpeakerAverage?.score ?? null,
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
              />
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

type HeaderMetric = {
  label: string;
  value: number | string;
  hint?: string;
  accent?: 'gold' | 'blue' | 'pos' | 'neg';
};

/**
 * Choose the 3–5 summary tiles based on the user's role mix. A pure speaker
 * shouldn't stare at "Prelims chaired: 0"; a pure judge shouldn't see
 * "Breaks: 0" front and centre. Tiles that resolve to zero/null are
 * skipped, then the strongest leftovers fill the strip.
 */
function pickHeaderMetrics(input: {
  totalTournaments: number;
  breaks: number;
  totalRoundsChaired: number;
  outroundsChaired: number;
  bestSpeakerRank: number | null;
  bestSpeakerAverage: number | null;
  speakerCount: number;
  judgeCount: number;
  activeYears: { from: number; to: number } | null;
}): HeaderMetric[] {
  const {
    totalTournaments,
    breaks,
    totalRoundsChaired,
    outroundsChaired,
    bestSpeakerRank,
    bestSpeakerAverage,
    speakerCount,
    judgeCount,
  } = input;

  const speakerLeaning = judgeCount === 0 || speakerCount >= judgeCount * 3;
  const judgeLeaning = speakerCount === 0 || judgeCount >= speakerCount * 3;

  const candidates: HeaderMetric[] = [];

  if (totalTournaments > 0) {
    candidates.push({
      label: 'Tournaments',
      value: totalTournaments,
      hint:
        speakerCount > 0 && judgeCount > 0
          ? `${speakerCount} speaking · ${judgeCount} judging`
          : undefined,
    });
  }

  if (speakerLeaning) {
    if (breaks > 0) {
      candidates.push({
        label: 'Breaks',
        value: breaks,
        accent: 'gold',
        hint: totalTournaments > 0 ? `${Math.round((breaks / totalTournaments) * 100)}% of entries` : undefined,
      });
    }
    if (bestSpeakerAverage != null) {
      candidates.push({ label: 'Best speaker avg', value: bestSpeakerAverage.toFixed(1) });
    }
    if (bestSpeakerRank != null) {
      candidates.push({ label: 'Best speaker rank', value: `#${bestSpeakerRank}` });
    }
  } else if (judgeLeaning) {
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired, accent: 'gold' });
    }
  } else {
    if (breaks > 0) candidates.push({ label: 'Breaks', value: breaks, accent: 'gold' });
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired });
    }
  }

  return candidates.slice(0, 4);
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

function ReportCell({ r }: { r: { tournamentId: bigint; tournamentName: string; hasOpenReport: boolean } }) {
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
}: {
  r: SpeakingTableRow;
  motionsByRound: Map<string, CvTaggedMotion[]>;
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
    <details className="group">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 py-2 text-caption text-ink-soft hover:text-ink">
        <ChevronDown
          className="h-3.5 w-3.5 text-primary transition-transform group-open:rotate-180"
          aria-hidden
        />
        Round ledger — {roundNumbers.length} round{roundNumbers.length === 1 ? '' : 's'}
        {anyMotion ? ' with motions' : ''}
      </summary>
      <div className="panel-inset mb-3 overflow-x-auto p-3">
        <Table className="text-caption">
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
                            <span className="ml-1 text-ink-soft/70">
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
}: {
  rows: SpeakingTableRow[];
  motionsByRound: Map<string, CvTaggedMotion[]>;
  fieldByTournament: Map<string, CvFieldStat>;
}) {
  return (
    <>
      {/* Desktop ledger */}
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="min-w-max">
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th numeric>Year</Th>
                <Th>Format</Th>
                <Th numeric>Teams</Th>
                <Th>Team</Th>
                <Th>Partner</Th>
                <Th numeric>Team rank</Th>
                <Th numeric>Pts</Th>
                <Th numeric title="Average speaker score per prelim round spoken">
                  Spk avg
                </Th>
                <Th numeric title="Where that average placed among every speaker on the tab">
                  Field
                </Th>
                <Th title="Speaker rank within each break category. Open = main draw; ESL = English as Second Language; EFL = English as Foreign Language.">
                  Rank
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
                return (
                  <Tr key={r.tournamentId.toString()} className="align-top">
                    <Td className="pl-4">
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex max-w-[16rem] items-center gap-1 truncate font-medium text-ink hover:text-primary"
                        title={r.tournamentName}
                      >
                        <span className="truncate">{r.tournamentName}</span>
                        <ExternalLink
                          className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                          aria-hidden
                        />
                      </a>
                      <div className="text-caption text-ink-soft">{r.myName}</div>
                      <RoundLedger r={r} motionsByRound={motionsByRound} />
                    </Td>
                    <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                    <Td className="whitespace-nowrap text-ink-soft">{r.format ?? <Nil />}</Td>
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
                    <Td className="whitespace-nowrap">
                      {outround ? (
                        <span className="flex items-center gap-1.5">
                          {r.broke ? <Badge variant="gold">Broke</Badge> : null}
                          <span className="text-ink">{outround}</span>
                        </span>
                      ) : r.broke ? (
                        <Badge variant="gold">Broke</Badge>
                      ) : (
                        <Nil />
                      )}
                    </Td>
                    <Td className="pr-4">
                      <ReportCell r={r} />
                    </Td>
                  </Tr>
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
                  className="truncate font-display text-h4 font-medium text-ink"
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

function JudgingTable({ rows }: { rows: JudgingTableRow[] }) {
  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="min-w-max">
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
                    <div className="text-caption text-ink-soft">{r.myName}</div>
                  </Td>
                  <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{r.format ?? <Nil />}</Td>
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
                    <ReportCell r={r} />
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
                className="truncate font-display text-h4 font-medium text-ink"
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
