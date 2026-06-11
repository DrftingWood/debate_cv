import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Trophy,
  Search,
  ChevronDown,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CvRowReportButton } from '@/components/CvRowReportButton';
import { AutoScanOnVisit } from '@/components/AutoScanOnVisit';
import { CvNeedsAttentionBanners } from '@/components/CvNeedsAttentionBanners';
import { CvHighlights } from '@/components/CvHighlights';
import { CvShareButton } from '@/components/CvShareButton';
import { CvDownloadButton } from '@/components/CvDownloadButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatBlock } from '@/components/ui/StatBlock';
import { BreakMarker } from '@/components/ui/BreakMarker';
import { ResultLine } from '@/components/ui/ResultLine';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = {
  title: 'My CV',
  description: 'Your debate tournament history, compiled from your Gmail.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';


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
  const { user, speakerRows, judgeRows, unmatchedTournaments: unmatched, summary, highlights } = data;
  const { totalTournaments, breaks, totalRoundsChaired } = summary;
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


  return (
    <div className="space-y-10">
      <AutoScanOnVisit />
      <CvNeedsAttentionBanners
        pendingCount={pendingCount}
        unmatchedCount={unmatched.length}
      />
      {/* Record masthead — name over ruled headline-fact StatBlocks */}
      <header className="space-y-4">
        <div className="eyebrow">
          DEBATE CV — PRIVATE RECORD · COMPILED{' '}
          {new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).toUpperCase()}
        </div>

        <h1 className="display-expanded font-display text-h1 font-bold leading-[1.05] tracking-tight text-record-ink md:text-display">
          {user?.name ?? 'Debater'}
        </h1>

        <hr className="hairline" />

        <div className="meta">
          {user?.email ?? ''}
        </div>

        {headerMetrics.length > 0 ? (
          <div
            className={
              'mt-4 grid gap-6 ' +
              (headerMetrics.length === 1
                ? 'grid-cols-1'
                : headerMetrics.length === 2
                  ? 'grid-cols-2'
                  : headerMetrics.length === 3
                    ? 'grid-cols-3'
                    : 'grid-cols-2 md:grid-cols-4')
            }
          >
            {headerMetrics.map((m, i) => (
              <StatBlock key={i} label={m.label} value={m.value} />
            ))}
          </div>
        ) : null}
      </header>

      {/* The record's one-line summary — factual mono, not literary prose —
          plus the two actions performed ON the record: Share and Download. */}
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <p className="font-mono text-caption text-record-muted md:max-w-2xl">
          {toBriefLine({
            totalTournaments: summary.totalTournaments,
            speakerCount: speakerRows.length,
            judgeCount: judgeRows.length,
            breaks: summary.breaks,
            yearStart: highlights.activeYears?.from ?? null,
          })}
        </p>

        <div className="flex flex-wrap items-center gap-2" data-print-hide="true">
          <CvShareButton />
          <CvDownloadButton />
        </div>
      </section>

      {totalTournaments === 0 ? (
        <EmptyState
          icon={<Trophy className="h-5 w-5" aria-hidden />}
          title="No tournaments ingested yet"
          description={
            <>
              Two steps from the dashboard: <strong>Scan Gmail</strong> finds the URLs, then{' '}
              <strong>Ingest all</strong> parses each tournament. Once that completes, your CV
              will populate here.
            </>
          }
          action={
            <Link href="/dashboard">
              <Button variant="primary" leftIcon={<Search className="h-4 w-4" aria-hidden />}>
                Open dashboard
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <CvHighlights highlights={highlights} />

          {speakerRows.length > 0 ? (
            <section aria-label="Speaking" className="space-y-0">
              <SectionHeader title="Speaking" count={speakerRows.length} />
              <SpeakingTable rows={speakerRows} />
            </section>
          ) : null}

          {judgeRows.length > 0 ? (
            <section aria-label="Judging" className="space-y-0">
              <SectionHeader title="Judging" count={judgeRows.length} />
              <JudgingTable rows={judgeRows} />
            </section>
          ) : null}

          {/*
            Unmatched tournaments are surfaced via CvNeedsAttentionBanners
            at the top of the page (Q6); the per-row Find-me search lives
            on the dashboard's Unmatched filter.
          */}
        </>
      )}
    </div>
  );
}

/**
 * The record's one-line factual summary: digits in the data face, parts
 * joined with interpuncts — `12 tournaments since 2022 · 5 breaks ·
 * speaker in 9 · chair in 3`. Replaces the editorial spelled-out-number
 * prose.
 */
function toBriefLine(input: {
  totalTournaments: number;
  speakerCount: number;
  judgeCount: number;
  breaks: number;
  yearStart: number | null;
}): string {
  const parts: string[] = [];
  if (input.totalTournaments > 0) {
    parts.push(
      `${input.totalTournaments} tournament${input.totalTournaments === 1 ? '' : 's'}` +
        (input.yearStart ? ` since ${input.yearStart}` : ''),
    );
  }
  if (input.breaks > 0) parts.push(`${input.breaks} break${input.breaks === 1 ? '' : 's'}`);
  if (input.speakerCount > 0) parts.push(`speaker in ${input.speakerCount}`);
  if (input.judgeCount > 0) parts.push(`chair in ${input.judgeCount}`);
  return parts.join(' · ');
}

type HeaderMetric = {
  label: string;
  value: number | string;
  accent?: boolean;
};

/**
 * Choose the 3–4 metric tiles for the /cv profile header based on the
 * user's role mix. A pure speaker shouldn't stare at "Prelims chaired: 0";
 * a pure judge shouldn't see "Breaks: 0" front-and-centre. Tiles that
 * resolve to zero/null are skipped, then the strongest leftovers fill the
 * row.
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
    activeYears,
  } = input;

  const speakerLeaning = judgeCount === 0 || speakerCount >= judgeCount * 3;
  const judgeLeaning = speakerCount === 0 || judgeCount >= speakerCount * 3;

  const candidates: (HeaderMetric | null)[] = [];

  // Always-present tournaments tile.
  if (totalTournaments > 0) {
    candidates.push({ label: 'Tournaments', value: totalTournaments });
  }

  if (speakerLeaning) {
    if (breaks > 0) candidates.push({ label: 'Breaks', value: breaks, accent: true });
    if (bestSpeakerRank != null) {
      candidates.push({ label: 'Best speaker rank', value: `#${bestSpeakerRank}` });
    }
    if (bestSpeakerAverage != null) {
      candidates.push({
        label: 'Best speaker avg',
        value: bestSpeakerAverage.toFixed(1),
      });
    }
  } else if (judgeLeaning) {
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired });
    }
    if (activeYears) {
      candidates.push({
        label: 'Active',
        value: activeYears.from === activeYears.to
          ? `${activeYears.from}`
          : `${activeYears.from}–${activeYears.to}`,
      });
    }
  } else {
    // Both-roles balanced.
    if (breaks > 0) candidates.push({ label: 'Breaks', value: breaks, accent: true });
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired });
    }
  }

  return candidates.filter((c): c is HeaderMetric => c !== null).slice(0, 4);
}



// Pretty-print speaker rank columns: "#5 Open · #3 ESL"
function fmtSpeakerRanks(r: {
  speakerRankOpen: number | null;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
}): string {
  const parts: string[] = [];
  if (r.speakerRankOpen != null) parts.push(`#${r.speakerRankOpen} Open`);
  if (r.speakerRankEsl != null) parts.push(`#${r.speakerRankEsl} ESL`);
  if (r.speakerRankEfl != null) parts.push(`#${r.speakerRankEfl} EFL`);
  return parts.join(' · ') || '—';
}

import type { CvSpeakerRow as SpeakingTableRow, CvJudgeRow as JudgingTableRow } from '@/lib/cv/buildCvData';

function BrokeBadge({ broke }: { broke: boolean }) {
  if (!broke) return <span className="text-record-muted">—</span>;
  return (
    <span role="status">
      <BreakMarker className="text-table">Broke</BreakMarker>
    </span>
  );
}

function fmtLastOutroundSpoken(r: SpeakingTableRow): string {
  // Show the actual outround stage (Quarterfinals, Semifinals, etc.) when
  // we have it. The break-tab rank lives in its own column; conflating
  // "made the break tab" with "spoke in an outround" misleads — a team can
  // appear on the break tab but lose in their first outround room.
  // When the user's team won the tournament's final, append "(Champion)" so
  // the row clearly distinguishes winners from grand-finalists.
  // EUDC dual-break case: if the team broke in multiple categories
  // (Open + ESL) the deepest outround per category is rendered together,
  // e.g. "Open: Octofinals · ESL: Grand Final".
  if (r.eliminationReachedByCategory && r.eliminationReachedByCategory.length > 1) {
    const joined = r.eliminationReachedByCategory
      .map((e) => `${e.category}: ${formatStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (Champion)` : joined;
  }
  if (!r.eliminationReached) return '—';
  const display = formatStageForDisplay(r.eliminationReached);
  if (r.wonTournament === true) return `${display} (Champion)`;
  return display;
}

// Expandable per-round score breakdown shown beneath each tournament row.
// Renders only when the parser captured per-round scores; uses a native
// <details> element so it works without client-side JS.
function SpeakingRow({ r }: { r: SpeakingTableRow }) {
  const hasRoundScores = r.roundScores.length > 0;
  return (
    <>
      <tr
        className={cn(
          'align-top border-b border-record-rule/40 hover:bg-record-ink/[0.02]',
          r.broke && 'border-l-2 border-l-break-gold',
        )}
      >
        <td className="px-4 py-2.5">
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-[14rem] truncate font-semibold text-record-ink hover:text-record-green"
            title={r.tournamentName}
          >
            {r.tournamentName}
          </a>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 num text-record-muted">{r.year ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-record-muted">{r.format ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5 num text-record-muted">{r.totalTeams ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5">{r.myName}</td>
        <td className="px-3 py-2.5 text-record-muted" title={r.teammates.join(', ')}>
          <span className="block max-w-[14rem] truncate">
            {r.teammates.length ? r.teammates.join(', ') : '—'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-record-muted" title={r.teamName ?? undefined}>
          <span className="block max-w-[12rem] truncate">{r.teamName ?? '—'}</span>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 num">
          {r.teamRank != null ? `#${r.teamRank}` : '—'}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 num">
          {r.teamPoints ?? (r.teamWins != null ? `${r.teamWins}W` : '—')}
        </td>
        <td
          className="whitespace-nowrap px-3 py-2.5 num"
          title={
            r.speakerAvgScore
              ? r.prelimsSpoken > 0
                ? `Average across ${r.prelimsSpoken} prelim ${r.prelimsSpoken === 1 ? 'round' : 'rounds'}`
                : 'Average from speaker tab'
              : ''
          }
        >
          {r.speakerAvgScore ?? '—'}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">{fmtSpeakerRanks(r)}</td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <BrokeBadge broke={r.broke} />
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          {r.broke && fmtLastOutroundSpoken(r) !== '—' ? (
            <BreakMarker className="text-table">{fmtLastOutroundSpoken(r)}</BreakMarker>
          ) : (
            fmtLastOutroundSpoken(r)
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {r.hasOpenReport ? (
              <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-label font-semibold text-record-green border-b border-record-green/40">
                Reported
              </span>
            ) : null}
            <CvRowReportButton
              tournamentId={r.tournamentId.toString()}
              tournamentName={r.tournamentName}
            />
          </div>
        </td>
      </tr>
      {hasRoundScores ? (
        <tr className="bg-sheet">
          <td colSpan={14} className="px-4 py-0">
            <details className="group">
              <summary className="cursor-pointer select-none py-1.5 text-meta text-record-muted hover:text-record-ink">
                <ChevronDown className="mr-1 inline h-3.5 w-3.5 text-record-green transition-transform group-open:rotate-180" aria-hidden />
                Per-round speaker scores ({r.roundScores.length})
              </summary>
              <div className="overflow-x-auto pb-3 pt-1">
                <table className="text-caption">
                  <thead>
                    <tr className="text-record-muted uppercase tracking-[0.14em] text-label font-semibold">
                      {r.roundScores.map((s) => (
                        <th
                          key={`${s.roundNumber}:${s.positionLabel ?? ''}`}
                          className="whitespace-nowrap px-2 py-1 text-left font-medium"
                        >
                          R{s.roundNumber}
                          {s.positionLabel ? ` (${s.positionLabel})` : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {r.roundScores.map((s) => (
                        <td
                          key={`${s.roundNumber}:${s.positionLabel ?? ''}`}
                          className="whitespace-nowrap px-2 py-1 num text-record-ink"
                        >
                          {s.score != null ? s.score.toFixed(1) : '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SpeakingTable({ rows }: { rows: SpeakingTableRow[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="min-w-max text-table">
          <thead>
            <tr className="border-b border-record-rule/50 text-left align-bottom">
              <th className="data-label whitespace-nowrap px-4 py-2.5">Tournament</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Year</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Format</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Teams</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">My name</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Teammate(s)</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Team</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Team rank</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Team points</th>
              <th
                className="data-label whitespace-nowrap px-3 py-2.5"
                title="Average speaker score per prelim round spoken"
              >
                Spkr avg
              </th>
              <th
                className="data-label whitespace-nowrap px-3 py-2.5"
                title="Speaker rank within each break category. Open = main draw; ESL = English as Second Language; EFL = English as Foreign Language."
              >
                Rank
              </th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Broken</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Last outround spoken</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5" aria-label="Report" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SpeakingRow key={r.tournamentId.toString()} r={r} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile result lines — two dense rows per tournament, details on tap */}
      <div className="md:hidden">
        {rows.map((r) => (
          <ResultLine
            key={r.tournamentId.toString()}
            title={
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                {r.tournamentName}
              </a>
            }
            meta={r.year ?? undefined}
            broke={r.broke}
            data={
              <span>
                {r.teamRank != null ? `#${r.teamRank}` : '—'}
                {r.speakerAvgScore != null ? ` · ${r.speakerAvgScore} avg` : ''}
                {fmtSpeakerRanks(r) !== '—' ? ` · ${fmtSpeakerRanks(r)}` : ''}
              </span>
            }
            result={
              r.broke && fmtLastOutroundSpoken(r) !== '—' ? (
                <BreakMarker>{fmtLastOutroundSpoken(r)}</BreakMarker>
              ) : undefined
            }
          >
            <details className="pt-1">
              <summary className="cursor-pointer select-none text-meta text-record-muted">
                Details
              </summary>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 text-caption">
                {r.format ? <Field label="Format" value={r.format} /> : null}
                {r.totalTeams != null ? <Field label="Teams" value={String(r.totalTeams)} mono /> : null}
                <Field label="My name" value={r.myName} />
                {r.teammates.length ? <Field label="Teammates" value={r.teammates.join(', ')} /> : null}
                {r.teamName ? <Field label="Team" value={r.teamName} /> : null}
                {r.teamPoints ? <Field label="Team points" value={r.teamPoints} mono /> : null}
                {r.speakerAvgScore && r.prelimsSpoken > 0 ? (
                  <Field label="Prelims spoken" value={String(r.prelimsSpoken)} mono />
                ) : null}
              </dl>
              <div className="flex items-center gap-1.5 pt-2">
                {r.hasOpenReport ? (
                  <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-label font-semibold text-record-green border-b border-record-green/40">
                    Reported
                  </span>
                ) : null}
                <CvRowReportButton
                  tournamentId={r.tournamentId.toString()}
                  tournamentName={r.tournamentName}
                />
              </div>
            </details>
          </ResultLine>
        ))}
      </div>
    </>
  );
}

function JudgingTable({ rows }: { rows: JudgingTableRow[] }) {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="min-w-max text-table">
          <thead>
            <tr className="border-b border-record-rule/50 text-left align-bottom">
              <th className="data-label whitespace-nowrap px-4 py-2.5">Tournament</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Year</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Format</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Teams</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">My name</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Judge type</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Inrounds judged</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Inrounds chaired</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Broken</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Last outround chaired</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5">Last outround judged</th>
              <th className="data-label whitespace-nowrap px-3 py-2.5" aria-label="Report" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tournamentId.toString()} className="align-top border-b border-record-ink/10 hover:bg-record-ink/[0.02]">
                <td className="px-4 py-2.5">
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-[14rem] truncate font-medium text-record-ink hover:text-record-green"
                    title={r.tournamentName}
                  >
                    {r.tournamentName}
                  </a>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 num text-record-muted">{r.year ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-record-muted">{r.format ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 num text-record-muted">{r.totalTeams ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.myName}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-record-muted">{r.judgeTypeTag ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 num">{r.inroundsJudged ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 num">{r.inroundsChaired ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5"><BrokeBadge broke={r.broke} /></td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.lastOutroundChaired ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.lastOutroundJudged ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {r.hasOpenReport ? (
                      <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-label font-semibold text-record-green border-b border-record-green/40">
                        Reported
                      </span>
                    ) : null}
                    <CvRowReportButton
                      tournamentId={r.tournamentId.toString()}
                      tournamentName={r.tournamentName}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden">
        {rows.map((r) => (
          <ResultLine
            key={r.tournamentId.toString()}
            title={
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                {r.tournamentName}
              </a>
            }
            meta={r.year ?? undefined}
            broke={r.broke}
            data={
              <span>
                {r.inroundsJudged != null ? `${r.inroundsJudged} prelims` : '—'}
                {r.inroundsChaired != null ? ` · ${r.inroundsChaired} chaired` : ''}
                {r.lastOutroundChaired ? ` · ${r.lastOutroundChaired} chair` : ''}
              </span>
            }
          >
            <details className="pt-1">
              <summary className="cursor-pointer select-none text-meta text-record-muted">
                Details
              </summary>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 text-caption">
                {r.format ? <Field label="Format" value={r.format} /> : null}
                {r.totalTeams != null ? <Field label="Teams" value={String(r.totalTeams)} mono /> : null}
                <Field label="My name" value={r.myName} />
                {r.judgeTypeTag ? <Field label="Judge type" value={r.judgeTypeTag} /> : null}
                {r.lastOutroundJudged ? <Field label="Last outround judged" value={r.lastOutroundJudged} /> : null}
              </dl>
              <div className="flex items-center gap-1.5 pt-2">
                {r.hasOpenReport ? (
                  <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-label font-semibold text-record-green border-b border-record-green/40">
                    Reported
                  </span>
                ) : null}
                <CvRowReportButton
                  tournamentId={r.tournamentId.toString()}
                  tournamentName={r.tournamentName}
                />
              </div>
            </details>
          </ResultLine>
        ))}
      </div>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-meta text-record-muted uppercase tracking-[0.12em]">{label}</dt>
      <dd className={'mt-0.5 text-record-ink ' + (mono ? 'num' : '')}>{value}</dd>
    </div>
  );
}
