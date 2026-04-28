import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Trophy,
  Search,
  Mail,
  MapPin,
  Mic,
  Gavel,
  ChevronDown,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CvRowReportButton } from '@/components/CvRowReportButton';
import { AutoScanOnVisit } from '@/components/AutoScanOnVisit';
import { CvNeedsAttentionBanners } from '@/components/CvNeedsAttentionBanners';
import { CvHighlights } from '@/components/CvHighlights';
import { CvShareButton } from '@/components/CvShareButton';

export const metadata: Metadata = {
  title: 'My CV',
  description: 'Your debate tournament history, compiled from your Gmail.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

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
      {/* Profile header */}
      <header className="relative overflow-hidden rounded-card border border-border shadow-sm">
        <div aria-hidden className="absolute inset-0 bg-gradient-hero" />
        <div aria-hidden className="absolute inset-0 hero-texture opacity-60" />
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-5">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-accent font-display text-[20px] font-semibold text-white shadow-md">
              {initials(user?.name ?? user?.email)}
            </div>
            <div>
              <h1 className="font-display text-h2 font-semibold tracking-tight text-foreground">
                {user?.name ?? 'Debater'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                {user?.email ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    {user.email}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  Auto-built from Gmail
                </span>
              </div>
            </div>
          </div>
          {headerMetrics.length > 0 ? (
            <div
              className={`grid gap-3 md:min-w-[380px] ${
                headerMetrics.length === 1
                  ? 'grid-cols-1'
                  : headerMetrics.length === 2
                    ? 'grid-cols-2'
                    : headerMetrics.length === 3
                      ? 'grid-cols-3'
                      : 'grid-cols-2 md:grid-cols-4'
              }`}
            >
              {headerMetrics.map((m, i) => (
                <MetricTile
                  key={i}
                  label={m.label}
                  value={m.value}
                  accent={m.accent}
                  mono={m.mono}
                />
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {/* Summary row + actions */}
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <Badge variant="outline">{totalTournaments} tournaments</Badge>
        <Badge variant={speakerRows.length > 0 ? 'success' : 'neutral'}>
          {speakerRows.length} as speaker
        </Badge>
        <Badge variant={judgeRows.length > 0 ? 'info' : 'neutral'}>
          {judgeRows.length} as judge
        </Badge>
        <span className="ml-auto" />
        <CvShareButton />
        <details className="group relative">
          <summary className="list-none">
            <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted">
              More
            </span>
          </summary>
          <div className="absolute right-0 z-10 mt-2 w-[220px] rounded-card border border-border bg-card p-2 shadow-md">
            <div className="flex flex-col gap-1.5">
              <Link href="/cv/verify">
                <Button variant="outline" size="sm" className="w-full justify-start">Verify extracted fields</Button>
              </Link>
              <a href="/api/cv/export">
                <Button variant="outline" size="sm" className="w-full justify-start">Export CSV</Button>
              </a>
            </div>
          </div>
        </details>
      </div>

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
            <CollapsibleSection
              title="Speaking"
              count={speakerRows.length}
              icon={<Mic className="h-4 w-4 text-primary" aria-hidden />}
              defaultOpen
            >
              <SpeakingTable rows={speakerRows} />
            </CollapsibleSection>
          ) : null}

          {judgeRows.length > 0 ? (
            <CollapsibleSection
              title="Judging"
              count={judgeRows.length}
              icon={<Gavel className="h-4 w-4 text-primary" aria-hidden />}
              defaultOpen
            >
              <JudgingTable rows={judgeRows} />
            </CollapsibleSection>
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

type HeaderMetric = {
  label: string;
  value: number | string;
  accent?: boolean;
  mono?: boolean;
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
        mono: true,
      });
    }
  } else if (judgeLeaning) {
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired, mono: true });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired, mono: true });
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
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired, mono: true });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired, mono: true });
    }
  }

  return candidates.filter((c): c is HeaderMetric => c !== null).slice(0, 4);
}

function MetricTile({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className={
        'rounded-card border border-border bg-card/80 px-3 py-2.5 shadow-xs backdrop-blur-sm' +
        (accent ? ' bg-primary-soft/70' : '')
      }
    >
      <div className="text-caption text-muted-foreground">{label}</div>
      <div
        className={
          'mt-0.5 font-display text-[20px] font-semibold leading-tight text-foreground' +
          (mono ? ' font-mono' : '')
        }
      >
        {value}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-card border border-border bg-card/60 shadow-xs"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-4 md:px-6">
        <div className="inline-flex items-center gap-2">
          {icon}
          <h2 className="font-display text-h4 font-semibold text-foreground">{title}</h2>
          <Badge variant="neutral">{count}</Badge>
        </div>
        <ChevronDown
          className="h-4 w-4 text-muted-foreground transition-transform duration-[180ms] ease-soft group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
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
  return broke ? (
    <Badge variant="success">Yes</Badge>
  ) : (
    <Badge variant="neutral">No</Badge>
  );
}

function fmtLastOutroundSpoken(r: SpeakingTableRow): string {
  // Show the actual outround stage (Quarterfinals, Semifinals, etc.) when
  // we have it. The break-tab rank lives in its own column; conflating
  // "made the break tab" with "spoke in an outround" misleads — a team can
  // appear on the break tab but lose in their first outround room.
  // When the user's team won the tournament's final, append "(Champion)" so
  // the row clearly distinguishes winners from grand-finalists.
  if (!r.eliminationReached) return '—';
  if (r.wonTournament === true) return `${r.eliminationReached} (Champion)`;
  return r.eliminationReached;
}

// Expandable per-round score breakdown shown beneath each tournament row.
// Renders only when the parser captured per-round scores; uses a native
// <details> element so it works without client-side JS.
function SpeakingRow({ r }: { r: SpeakingTableRow }) {
  const hasRoundScores = r.roundScores.length > 0;
  return (
    <>
      <tr className="align-top hover:bg-muted/20">
        <td className="px-4 py-2.5">
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-[14rem] truncate font-medium text-foreground hover:text-primary"
            title={r.tournamentName}
          >
            {r.tournamentName}
          </a>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">{r.year ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.format ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">{r.totalTeams ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2.5">{r.myName}</td>
        <td className="px-3 py-2.5 text-muted-foreground" title={r.teammates.join(', ')}>
          <span className="block max-w-[14rem] truncate">
            {r.teammates.length ? r.teammates.join(', ') : '—'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-muted-foreground" title={r.teamName ?? undefined}>
          <span className="block max-w-[12rem] truncate">{r.teamName ?? '—'}</span>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono">
          {r.teamRank != null ? `#${r.teamRank}` : '—'}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono">
          {r.teamPoints ?? (r.teamWins != null ? `${r.teamWins}W` : '—')}
        </td>
        <td
          className="whitespace-nowrap px-3 py-2.5 font-mono"
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
            {r.hasOpenReport ? <Badge variant="warning">Reported</Badge> : null}
            <CvRowReportButton
              tournamentId={r.tournamentId.toString()}
              tournamentName={r.tournamentName}
            />
          </div>
        </td>
      </tr>
      {hasRoundScores ? (
        <tr className="bg-muted/10">
          <td colSpan={14} className="px-4 py-0">
            <details className="group">
              <summary className="cursor-pointer select-none py-1.5 text-caption text-muted-foreground hover:text-foreground">
                <ChevronDown className="mr-1 inline h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
                Per-round speaker scores ({r.roundScores.length})
              </summary>
              <div className="overflow-x-auto pb-3 pt-1">
                <table className="text-caption">
                  <thead>
                    <tr className="text-muted-foreground">
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
                          className="whitespace-nowrap px-2 py-1 font-mono text-foreground"
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
        <table className="min-w-max text-[13.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left align-bottom text-caption text-muted-foreground">
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
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <SpeakingRow key={r.tournamentId.toString()} r={r} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.tournamentId.toString()} className="space-y-2 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-display text-[14.5px] font-semibold text-foreground"
              >
                {r.tournamentName}
              </a>
              <span className="whitespace-nowrap font-mono text-caption text-muted-foreground">
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
              {r.hasOpenReport ? <Badge variant="warning">Reported</Badge> : null}
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
        <table className="min-w-max text-[13.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left align-bottom text-caption text-muted-foreground">
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
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.tournamentId.toString()} className="align-top hover:bg-muted/20">
                <td className="px-4 py-2.5">
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-[14rem] truncate font-medium text-foreground hover:text-primary"
                    title={r.tournamentName}
                  >
                    {r.tournamentName}
                  </a>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">{r.year ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.format ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">{r.totalTeams ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.myName}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.judgeTypeTag ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono">{r.inroundsJudged ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono">{r.inroundsChaired ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5"><BrokeBadge broke={r.broke} /></td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.lastOutroundChaired ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.lastOutroundJudged ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {r.hasOpenReport ? <Badge variant="warning">Reported</Badge> : null}
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

      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.tournamentId.toString()} className="space-y-2 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-display text-[14.5px] font-semibold text-foreground"
              >
                {r.tournamentName}
              </a>
              <span className="whitespace-nowrap font-mono text-caption text-muted-foreground">
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
              {r.hasOpenReport ? <Badge variant="warning">Reported</Badge> : null}
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
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={'mt-0.5 text-foreground ' + (mono ? 'font-mono' : '')}>{value}</dd>
    </div>
  );
}
