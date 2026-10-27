import type { Metadata } from 'next';
import { formatAbbrev } from '@/lib/calicotab/format';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { buildCvData, type CvJudgeRow, type CvSpeakerRow } from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { computeSpeakerStats } from '@/lib/cv/speakerStats';
import { CvHighlights } from '@/components/CvHighlights';
import { DownloadPdfButton } from '@/components/DownloadPdfButton';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import { TournamentLink } from '@/components/TournamentCard';
import { teamTabPlacement, formatTeamTabPlacement } from '@/lib/cv/teamPlacement';
import {
  PublicBreakMarker,
  PublicJudgeCard,
  PublicSpeakerCard,
  fmtPublicLastOutround,
} from './PublicRecordCards';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const user = await prisma.user.findUnique({
    where: { publicCvSlug: slug },
    select: { publicCvEnabled: true, name: true },
  });
  if (!user || !user.publicCvEnabled) {
    return { title: 'CV not found', robots: { index: false, follow: false } };
  }
  return {
    // Just the name — the root layout's metadata template is '%s · debate cv'
    // and appends the suffix itself. Spelling it out here too rendered
    // "Ritabrata Mitra · debate cv · debate cv" in the tab and in the
    // link preview.
    title: user.name ?? 'Debater',
    description: `${user.name ?? 'A debater'}'s tournament history.`,
    robots: { index: false, follow: false, nocache: true },
  };
}

/**
 * Public read-only CV (`/u/<slug>`) — the credentialing artifact.
 *
 * Same data as the owner's /cv with every owner-only affordance stripped:
 * no report buttons, no banners, no share/settings links, no auto-scan, no
 * expandable round ledger (a public record should be readable in one pass,
 * and the print stylesheet forces <details> open anyway).
 *
 * Where this deliberately goes beyond the owner view is the summary strip:
 * a reader who does not know the person needs the headline position before
 * the table, the same way a statement leads with the balance.
 */
export default async function PublicCvPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await prisma.user.findUnique({
    where: { publicCvSlug: slug },
    select: {
      id: true,
      name: true,
      image: true,
      publicCvEnabled: true,
      publicAvatarEnabled: true,
    },
  });
  if (!user || !user.publicCvEnabled) notFound();

  // No field stats: this page shows the owner's own figures only, and the
  // field summary is the single heaviest query in buildCvData. Skipping it
  // keeps an unauthenticated, force-dynamic route cheap to serve.
  const data = await buildCvData(user.id, { includeFieldStats: false });
  const { speakerRows, judgeRows, summary, highlights } = data;
  const stats = computeSpeakerStats(data);

  // The newest ingest, not the render date (CV-10).
  const updated = data.lastIngestedAt
    ? data.lastIngestedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  const summaryTiles: React.ReactNode[] = [];
  if (summary.totalTournaments > 0) {
    summaryTiles.push(
      <StatTile
        key="t"
        label="Tournaments"
        value={summary.totalTournaments}
        hint={
          speakerRows.length > 0 && judgeRows.length > 0
            ? `${speakerRows.length} speaking · ${judgeRows.length} judging`
            : undefined
        }
      />,
    );
  }
  if (summary.breaks > 0) {
    // Break strength is the furthest outround reached, so the count carries it.
    const deepest = highlights.deepestBreaks[0]?.stage;
    summaryTiles.push(
      <StatTile
        key="b"
        label="Breaks"
        value={summary.breaks}
        accent="gold"
        hint={deepest ? `Deepest: ${formatStageForDisplay(deepest)}` : undefined}
      />,
    );
  }
  if (stats.scoreProfile.mean != null) {
    summaryTiles.push(
      <StatTile
        key="a"
        label="Career speaker average"
        value={stats.scoreProfile.mean.toFixed(1)}
        hint={`${stats.scoreProfile.speeches} scored speeches`}
      />,
    );
  }
  if (highlights.activeYears) {
    summaryTiles.push(
      <StatTile
        key="y"
        label="Active"
        value={
          highlights.activeYears.from === highlights.activeYears.to
            ? `${highlights.activeYears.from}`
            : `${highlights.activeYears.from}–${highlights.activeYears.to}`
        }
      />,
    );
  }

  return (
    <div className="w-full flex-1 space-y-8">
      <header className="border-b border-border pb-6">
        {/*
          No theme toggle here. This page's layout pins `data-theme="light"`
          on its wrapper so the credential looks identical for every viewer
          and matches print, which meant the toggle that used to sit in this
          corner swapped its own sun/moon icon and changed nothing else on
          the page. A control that visibly does nothing is worse than no
          control; the forced-light decision is the one that stands.
        */}
        <div className="data-label">Public debate record{updated ? ` · updated ${updated}` : ''}</div>
        <div className="mt-3 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            {user.publicAvatarEnabled && user.image ? (
              // The name is the h1 right beside it, so the photo is decorative
              // here: alt="" stops a screen reader saying the name twice.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="h-16 w-16 rounded-lg border border-border object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-2 font-mono text-h3 text-ink"
              >
                {initials(user.name)}
              </div>
            )}
            <div>
              <h1 className="font-display text-h1 font-medium tracking-tight text-ink">
                <span className="sr-only">Debate record of </span>
                {user.name ?? 'Debater'}
              </h1>
              {/*
                The count is the record's own tournament total, the same
                figure as the Tournaments tile. It used to count ingested
                tab links, which could disagree with the tile beside it on
                the one page a stranger reads as a credential.
              */}
              <p className="mt-1 text-table text-ink-soft">
                {summary.totalTournaments} tournament
                {summary.totalTournaments === 1 ? '' : 's'} · sourced from tournament tab pages
              </p>
            </div>
          </div>
          <div data-print-hide="true">
            <DownloadPdfButton />
          </div>
        </div>
      </header>

      {summaryTiles.length > 0 ? (
        <StatRow columns={Math.min(summaryTiles.length, 4)}>{summaryTiles}</StatRow>
      ) : null}

      <CvHighlights highlights={highlights} />

      {speakerRows.length > 0 ? <SpeakingSection rows={speakerRows} /> : null}
      {judgeRows.length > 0 ? <JudgingSection rows={judgeRows} /> : null}

      {speakerRows.length === 0 && judgeRows.length === 0 ? (
        <EmptyState
          title="No tournaments on this record yet"
          description="Tournaments appear here once their tab pages have been read."
        />
      ) : null}

      <p className="border-t border-border pt-4 text-caption text-ink-soft">
        Every row links to the tournament tab it was read from, at calicotab.com,
        yellowtabs.com or herokuapp.com. Figures are as the tab published them.
      </p>
    </div>
  );
}

/**
 * Speaking record: a ledger from md up, one card per tournament below it.
 *
 * The table is `w-full`, not `min-w-max`. Sized to its widest content it
 * pushed the Result column (the break, the single most load-bearing fact on
 * a shareable credential) to the panel's edge at 1280 px and past it with a
 * multi-category result or a long team name. The tournament and team names
 * wrap instead.
 */
function SpeakingSection({ rows }: { rows: CvSpeakerRow[] }) {
  return (
    <section aria-label="Speaking" className="space-y-3">
      <SectionHeader
        label="Speaking"
        title={`${rows.length} tournament${rows.length === 1 ? '' : 's'}`}
      />
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full" label="Speaking record by tournament">
            <thead>
              <tr>
                <Th className="w-[30%] pl-4">Tournament</Th>
                <Th numeric>Year</Th>
                <Th>Format</Th>
                <Th>Team</Th>
                <Th numeric title="Where the team finished on the prelim team tab">Team rank</Th>
                <Th
                  numeric
                  title="Open speaker-tab rank — an individual figure, not the team's placement"
                >
                  Spk-tab rank
                </Th>
                <Th numeric>Avg score</Th>
                <Th className="pr-4">Result</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.tournamentId.toString()}>
                  <Td className="pl-4">
                    <TableSourceLink href={r.sourceUrl} name={r.tournamentName} />
                  </Td>
                  <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                    {formatAbbrev(r.format) ?? <Nil />}
                  </Td>
                  <Td className="text-ink">
                    {r.teamName ? (
                      <span className="block max-w-[12rem] break-words">{r.teamName}</span>
                    ) : (
                      <Nil />
                    )}
                  </Td>
                  <Td numeric className="whitespace-nowrap" title={teamPlacementTitle(r)}>
                    {r.teamRank != null ? (
                      <>
                        #{r.teamRank}
                        {r.totalTeams != null ? (
                          <span className="text-ink-soft">/{r.totalTeams}</span>
                        ) : null}
                      </>
                    ) : (
                      <Nil />
                    )}
                  </Td>
                  <Td numeric>{r.speakerRankOpen != null ? `#${r.speakerRankOpen}` : <Nil />}</Td>
                  <Td numeric>{r.speakerAvgScore ?? <Nil />}</Td>
                  <Td className="min-w-[8rem] pr-4">
                    {r.broke || fmtPublicLastOutround(r) ? (
                      <PublicBreakMarker r={r} />
                    ) : (
                      <span className="text-ink-soft">Did not break</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      <ul className="space-y-3 md:hidden" aria-label="Speaking record by tournament">
        {rows.map((r) => (
          <PublicSpeakerCard key={r.tournamentId.toString()} r={r} />
        ))}
      </ul>

      {/*
        The column explanations used to live in `title` tooltips, which a
        phone never shows. Placement is a team fact (DESIGN_INSTRUCTIONS §9),
        so the legend says which rank is the team's and which is individual.
      */}
      <p className="text-caption text-ink-soft">
        Team rank is where the team finished on the prelim team tab, out of the teams on it.
        Speaker-tab rank is an individual figure on the open speaker tab, not the team's
        placement.
      </p>
    </section>
  );
}

function JudgingSection({ rows }: { rows: CvJudgeRow[] }) {
  return (
    <section aria-label="Judging" className="space-y-3">
      <SectionHeader
        label="Judging"
        title={`${rows.length} tournament${rows.length === 1 ? '' : 's'}`}
      />
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full" label="Judging record by tournament">
            <thead>
              <tr>
                <Th className="w-[30%] pl-4">Tournament</Th>
                <Th numeric>Year</Th>
                <Th>Format</Th>
                <Th numeric>Prelims chaired</Th>
                <Th numeric>Prelims judged</Th>
                <Th>Last outround chaired</Th>
                <Th className="pr-4">Last outround judged</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.tournamentId.toString()}>
                  <Td className="pl-4">
                    <TableSourceLink href={r.sourceUrl} name={r.tournamentName} />
                  </Td>
                  <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                    {formatAbbrev(r.format) ?? <Nil />}
                  </Td>
                  <Td numeric>{r.inroundsChaired ?? <Nil />}</Td>
                  <Td numeric>{r.inroundsJudged ?? <Nil />}</Td>
                  <Td>{formatStageForDisplay(r.lastOutroundChaired) || <Nil />}</Td>
                  <Td className="pr-4">{formatStageForDisplay(r.lastOutroundJudged) || <Nil />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      <ul className="space-y-3 md:hidden" aria-label="Judging record by tournament">
        {rows.map((r) => (
          <PublicJudgeCard key={r.tournamentId.toString()} r={r} />
        ))}
      </ul>
    </section>
  );
}

/** The shared link, same as /cv: wraps, shows the external-link icon, says it opens a new tab. */
function TableSourceLink({ href, name }: { href: string; name: string }) {
  return <TournamentLink name={name} href={href} className="coarse:min-h-[44px]" />;
}

function teamPlacementTitle(r: CvSpeakerRow): string | undefined {
  const p = teamTabPlacement(r.teamRank, r.totalTeams);
  return p ? formatTeamTabPlacement(p) : undefined;
}

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
