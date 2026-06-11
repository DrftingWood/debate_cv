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
import { CvSubNav } from '@/components/CvSubNav';

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
      {/* Editorial masthead — replaces the gradient profile + metric-tile grid */}
      <header className="space-y-4">
        <div className="kicker">
          DEBATE CV — PRIVATE RECORD · COMPILED{' '}
          {new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).toUpperCase()}
        </div>

        <h1 className="font-serif text-h1 italic leading-[1.05] tracking-tight text-ink md:text-display">
          {user?.name ?? 'Debater'}
        </h1>

        <hr className="hairline" />

        <div className="byline">
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
              <StatColumn key={i} label={m.label} value={m.value} />
            ))}
          </div>
        ) : null}
      </header>

      <CvSubNav active="record" />

      {/* In Brief — sentence summary + the two surviving actions. Share and
          Download earn standalone buttons; everything that used to hide in
          the "More" dropdown (Analytics, Verify) lives in the tab bar now. */}
      <section className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="md:max-w-2xl">
          <div className="kicker">IN BRIEF</div>
          <p className="mt-2 font-serif text-body-serif italic leading-relaxed text-ink/85">
            {toBriefSentence({
              totalTournaments: summary.totalTournaments,
              speakerCount: speakerRows.length,
              judgeCount: judgeRows.length,
              breaks: summary.breaks,
              yearStart: highlights.activeYears?.from ?? null,
            })}
          </p>
        </div>

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
            <section aria-label="Speaking" className="space-y-4">
              <header>
                <div className="kicker">I · SPEAKING — {speakerRows.length} TOURNAMENT{speakerRows.length === 1 ? '' : 'S'}</div>
              </header>
              <SpeakingTable rows={speakerRows} />
            </section>
          ) : null}

          {judgeRows.length > 0 ? (
            <section aria-label="Judging" className="space-y-4">
              <header>
                <div className="kicker">II · JUDGING — {judgeRows.length} TOURNAMENT{judgeRows.length === 1 ? '' : 'S'}</div>
              </header>
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
 * Render the CV summary as a single sober italic sentence in place of
 * coloured "X tournaments / Y as speaker / Z as judge" pill badges.
 * Spells out numbers below 20 in line with the publication's voice.
 */
function toBriefSentence(input: {
  totalTournaments: number;
  speakerCount: number;
  judgeCount: number;
  breaks: number;
  yearStart: number | null;
}): string {
  const spell = (n: number): string => {
    const words: Record<number, string> = {
      1: 'one',
      2: 'two',
      3: 'three',
      4: 'four',
      5: 'five',
      6: 'six',
      7: 'seven',
      8: 'eight',
      9: 'nine',
      10: 'ten',
      11: 'eleven',
      12: 'twelve',
      13: 'thirteen',
      14: 'fourteen',
      15: 'fifteen',
      16: 'sixteen',
      17: 'seventeen',
      18: 'eighteen',
      19: 'nineteen',
    };
    if (n < 20) return words[n] ?? String(n);
    return String(n);
  };

  const parts: string[] = [];
  if (input.totalTournaments > 0) {
    parts.push(
      `${capitalize(spell(input.totalTournaments))} tournament${input.totalTournaments === 1 ? '' : 's'}` +
        (input.yearStart ? ` since ${input.yearStart}.` : '.'),
    );
  }
  if (input.breaks > 0) {
    parts.push(
      `${capitalize(spell(input.breaks))} break${input.breaks === 1 ? '' : 's'}.`,
    );
  }
  if (input.speakerCount > 0 && input.judgeCount > 0) {
    parts.push(
      `Speaker in ${spell(input.speakerCount)}, chair in ${spell(input.judgeCount)}.`,
    );
  } else if (input.speakerCount > 0) {
    parts.push(
      `Speaker in ${spell(input.speakerCount)} tournament${input.speakerCount === 1 ? '' : 's'}.`,
    );
  } else if (input.judgeCount > 0) {
    parts.push(
      `Chair in ${spell(input.judgeCount)} tournament${input.judgeCount === 1 ? '' : 's'}.`,
    );
  }

  return parts.join(' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

function StatColumn({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <div className="text-kicker text-ink-soft uppercase tracking-[0.16em]">
        {label}
      </div>
      <div className="mt-1 font-serif text-stat text-ink num">
        {value}
      </div>
    </div>
  );
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
  return (
    <span role="status" className="uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
      {broke ? 'Broken' : '—'}
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
      <tr className="align-top border-b border-ink/10 hover:bg-ink/[0.02]">
        <td className="px-4 py-2.5">
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-[14rem] truncate font-medium text-ink hover:text-oxblood"
            title={r.tournamentName}
          >
            {r.tournamentName}
          </a>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 num text-ink-soft">{r.year ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">{r.format ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5 num text-ink-soft">{r.totalTeams ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5">{r.myName}</td>
        <td className="px-3 py-2.5 text-ink-soft" title={r.teammates.join(', ')}>
          <span className="block max-w-[14rem] truncate">
            {r.teammates.length ? r.teammates.join(', ') : '—'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-ink-soft" title={r.teamName ?? undefined}>
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
        <td className="whitespace-nowrap px-3 py-2.5">{fmtLastOutroundSpoken(r)}</td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {r.hasOpenReport ? (
              <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-kicker font-semibold text-oxblood border-b border-oxblood/40">
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
        <tr className="bg-paper">
          <td colSpan={14} className="px-4 py-0">
            <details className="group">
              <summary className="cursor-pointer select-none py-1.5 text-byline text-ink-soft hover:text-ink">
                <ChevronDown className="mr-1 inline h-3.5 w-3.5 text-oxblood transition-transform group-open:rotate-180" aria-hidden />
                Per-round speaker scores ({r.roundScores.length})
              </summary>
              <div className="overflow-x-auto pb-3 pt-1">
                <table className="text-caption">
                  <thead>
                    <tr className="text-ink-soft uppercase tracking-[0.14em] text-kicker font-semibold">
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
                          className="whitespace-nowrap px-2 py-1 num text-ink"
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
            <tr className="border-y border-ink/15 text-left align-bottom uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Tournament</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Year</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Format</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Teams</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">My name</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Teammate(s)</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Team</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Team rank</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Team points</th>
              <th
                className="whitespace-nowrap px-3 py-2.5 font-medium"
                title="Average speaker score per prelim round spoken"
              >
                Spkr avg
              </th>
              <th
                className="whitespace-nowrap px-3 py-2.5 font-medium"
                title="Speaker rank within each break category. Open = main draw; ESL = English as Second Language; EFL = English as Foreign Language."
              >
                Rank
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Broken</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Last outround spoken</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium" aria-label="Report" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SpeakingRow key={r.tournamentId.toString()} r={r} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <ul className="md:hidden">
        {rows.map((r) => (
          <li key={r.tournamentId.toString()} className="space-y-2 border-t border-ink/10 py-5">
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-serif italic text-body text-ink"
              >
                {r.tournamentName}
              </a>
              <span className="whitespace-nowrap num text-caption text-ink-soft">
                {r.year ?? '—'}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
              {r.format ? <Field label="Format" value={r.format} /> : null}
              {r.totalTeams != null ? <Field label="Teams" value={String(r.totalTeams)} mono /> : null}
              <Field label="My name" value={r.myName} />
              {r.teammates.length ? <Field label="Teammates" value={r.teammates.join(', ')} /> : null}
              {r.teamName ? <Field label="Team" value={r.teamName} /> : null}
              {r.teamRank != null ? <Field label="Team rank" value={`#${r.teamRank}`} mono /> : null}
              {r.teamPoints ? <Field label="Team points" value={r.teamPoints} mono /> : null}
              {r.speakerAvgScore ? (
                <Field
                  label={
                    r.prelimsSpoken > 0
                      ? `Spkr avg (${r.prelimsSpoken} ${r.prelimsSpoken === 1 ? 'round' : 'rounds'})`
                      : 'Spkr avg'
                  }
                  value={r.speakerAvgScore}
                  mono
                />
              ) : null}
              {fmtSpeakerRanks(r) !== '—' ? <Field label="Rank" value={fmtSpeakerRanks(r)} /> : null}
              <Field label="Broken" value={r.broke ? 'Yes' : 'No'} />
              {fmtLastOutroundSpoken(r) !== '—' ? (
                <Field label="Last outround spoken" value={fmtLastOutroundSpoken(r)} />
              ) : null}
            </dl>
            <div className="flex items-center gap-1.5 pt-1">
              {r.hasOpenReport ? (
                <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-kicker font-semibold text-oxblood border-b border-oxblood/40">
                  Reported
                </span>
              ) : null}
              <CvRowReportButton
                tournamentId={r.tournamentId.toString()}
                tournamentName={r.tournamentName}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function JudgingTable({ rows }: { rows: JudgingTableRow[] }) {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="min-w-max text-table">
          <thead>
            <tr className="border-y border-ink/15 text-left align-bottom uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Tournament</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Year</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Format</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Teams</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">My name</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Judge type</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Inrounds judged</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Inrounds chaired</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Broken</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Last outround chaired</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Last outround judged</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium" aria-label="Report" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tournamentId.toString()} className="align-top border-b border-ink/10 hover:bg-ink/[0.02]">
                <td className="px-4 py-2.5">
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-[14rem] truncate font-medium text-ink hover:text-oxblood"
                    title={r.tournamentName}
                  >
                    {r.tournamentName}
                  </a>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 num text-ink-soft">{r.year ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">{r.format ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 num text-ink-soft">{r.totalTeams ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.myName}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">{r.judgeTypeTag ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 num">{r.inroundsJudged ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 num">{r.inroundsChaired ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5"><BrokeBadge broke={r.broke} /></td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.lastOutroundChaired ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.lastOutroundJudged ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {r.hasOpenReport ? (
                      <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-kicker font-semibold text-oxblood border-b border-oxblood/40">
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

      <ul className="md:hidden">
        {rows.map((r) => (
          <li key={r.tournamentId.toString()} className="space-y-2 border-t border-ink/10 py-5">
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-serif italic text-body text-ink"
              >
                {r.tournamentName}
              </a>
              <span className="whitespace-nowrap num text-caption text-ink-soft">
                {r.year ?? '—'}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
              {r.format ? <Field label="Format" value={r.format} /> : null}
              {r.totalTeams != null ? <Field label="Teams" value={String(r.totalTeams)} mono /> : null}
              <Field label="My name" value={r.myName} />
              {r.judgeTypeTag ? <Field label="Judge type" value={r.judgeTypeTag} /> : null}
              <Field label="Inrounds judged" value={r.inroundsJudged != null ? String(r.inroundsJudged) : '—'} mono />
              <Field label="Inrounds chaired" value={r.inroundsChaired != null ? String(r.inroundsChaired) : '—'} mono />
              <Field label="Broken" value={r.broke ? 'Yes' : 'No'} />
              {r.lastOutroundChaired ? <Field label="Last outround chaired" value={r.lastOutroundChaired} /> : null}
              {r.lastOutroundJudged ? <Field label="Last outround judged" value={r.lastOutroundJudged} /> : null}
            </dl>
            <div className="flex items-center gap-1.5 pt-1">
              {r.hasOpenReport ? (
                <span role="status" aria-label="Open report against this tournament" className="uppercase tracking-[0.14em] text-kicker font-semibold text-oxblood border-b border-oxblood/40">
                  Reported
                </span>
              ) : null}
              <CvRowReportButton
                tournamentId={r.tournamentId.toString()}
                tournamentName={r.tournamentName}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-byline text-ink-soft uppercase tracking-[0.12em]">{label}</dt>
      <dd className={'mt-0.5 text-ink ' + (mono ? 'num' : '')}>{value}</dd>
    </div>
  );
}
