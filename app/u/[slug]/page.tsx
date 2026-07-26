import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { buildCvData, type CvSpeakerRow } from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { formatAbbrev } from '@/lib/calicotab/format';
import { computeSpeakerStats } from '@/lib/cv/speakerStats';
import { CvHighlights } from '@/components/CvHighlights';
import { DownloadPdfButton } from '@/components/DownloadPdfButton';
import { Badge } from '@/components/ui/Badge';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';

function fmtPublicLastOutround(r: CvSpeakerRow): string | null {
  if (r.eliminationReachedByCategory && r.eliminationReachedByCategory.length > 1) {
    const joined = r.eliminationReachedByCategory
      .map((e) => `${e.category}: ${formatStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (Champion)` : joined;
  }
  if (!r.eliminationReached) return null;
  const display = formatStageForDisplay(r.eliminationReached);
  return r.wonTournament === true ? `${display} (Champion)` : display;
}

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
    title: `${user.name ?? 'Debater'} · debate cv`,
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
  const totalIngestedTournaments = await prisma.discoveredUrl.count({
    where: { userId: user.id, ingestedAt: { not: null } },
  });

  const compiled = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

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
    summaryTiles.push(<StatTile key="b" label="Breaks" value={summary.breaks} accent="gold" />);
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
          and matches print — which meant the toggle that used to sit in
          this corner swapped its own sun/moon icon and changed nothing else
          on the page. A control that visibly does nothing is worse than no
          control; the forced-light decision is the one that stands.
        */}
        <div className="data-label">Public debate record · compiled {compiled}</div>
        <div className="mt-3 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            {user.publicAvatarEnabled && user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name ?? 'Debater'}
                className="h-16 w-16 rounded-lg border border-border object-cover"
              />
            ) : (
              <div
                role="img"
                aria-label={`${user.name ?? 'Debater'} initials`}
                className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-2 font-mono text-h3 text-ink"
              >
                {initials(user.name)}
              </div>
            )}
            <div>
              <h1 className="font-display text-h1 font-medium tracking-tight text-ink">
                {user.name ?? 'Debater'}
              </h1>
              <p className="mt-1 text-table text-ink-soft">
                {totalIngestedTournaments} verified tournament
                {totalIngestedTournaments === 1 ? '' : 's'} · sourced from tournament tab pages
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

      {speakerRows.length > 0 ? (
        <section aria-label="Speaking" className="space-y-3">
          <SectionHeader
            label="Speaking"
            title={`${speakerRows.length} tournament${speakerRows.length === 1 ? '' : 's'}`}
          />
          <div className="panel hidden overflow-hidden md:block">
            <TableScroll>
              {/*
                Deliberately NOT `min-w-max` here, unlike the private ledger.
                Spelling every column to its widest content made this table
                1,135px wide inside a max-w-5xl document, so the Result
                column — the break, the outround, the single most load-
                bearing fact on a shareable credential — sat permanently
                off the right edge at EVERY viewport, reachable only by
                scrolling a container with no visible affordance. Letting
                the tournament name wrap costs a second line on the longest
                names and buys a table that fits the sheet.
              */}
              <Table className="w-full" label="Speaking record by tournament">
                <thead>
                  <tr>
                    {/*
                      The width hint makes the tournament name the column
                      that absorbs the slack. Without it the auto table
                      layout squeezed Team instead and broke "Maya G" across
                      two lines mid-name.
                    */}
                    <Th className="w-[34%] pl-4">Tournament</Th>
                    <Th numeric>Year</Th>
                    <Th>Format</Th>
                    <Th>Team</Th>
                    <Th numeric>Team rank</Th>
                    <Th numeric>Speaker rank</Th>
                    <Th numeric>Avg score</Th>
                    <Th className="pr-4">Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {speakerRows.map((r) => {
                    const outround = fmtPublicLastOutround(r);
                    return (
                      <Tr key={r.tournamentId.toString()}>
                        <Td className="pl-4">
                          <a
                            href={r.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[44px] items-center font-medium text-ink hover:text-primary"
                          >
                            {r.tournamentName}
                          </a>
                        </Td>
                        <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                        <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                          {formatAbbrev(r.format) ?? <Nil />}
                        </Td>
                        <Td className="whitespace-nowrap text-ink">{r.teamName ?? <Nil />}</Td>
                        <Td numeric>{r.teamRank != null ? `#${r.teamRank}` : <Nil />}</Td>
                        <Td numeric>
                          {r.speakerRankOpen != null ? `#${r.speakerRankOpen}` : <Nil />}
                        </Td>
                        <Td numeric>{r.speakerAvgScore ?? <Nil />}</Td>
                        <Td className="whitespace-nowrap pr-4">
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
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </div>

          {/*
            Phones get cards, not a squeezed ledger — the same treatment the
            private record has had since the rebuild. A shared CV link is
            opened on a phone at least as often as on a laptop, and the
            table needed 468px of sideways scroll at 390px wide with no
            visible affordance that there was anything to the right of it.
          */}
          <ul className="space-y-3 md:hidden">
            {speakerRows.map((r) => {
              const outround = fmtPublicLastOutround(r);
              return (
                <li key={r.tournamentId.toString()} className="panel p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block min-w-0 py-1 font-display text-h4 font-medium text-ink"
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
                    {r.speakerAvgScore ? (
                      <PublicField label="Avg score" value={r.speakerAvgScore} mono />
                    ) : null}
                    {r.speakerRankOpen != null ? (
                      <PublicField label="Speaker rank" value={`#${r.speakerRankOpen}`} mono />
                    ) : null}
                    {r.teamRank != null ? (
                      <PublicField label="Team rank" value={`#${r.teamRank}`} mono />
                    ) : null}
                    {r.teamName ? <PublicField label="Team" value={r.teamName} /> : null}
                    {r.format ? <PublicField label="Format" value={r.format} /> : null}
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {judgeRows.length > 0 ? (
        <section aria-label="Judging" className="space-y-3">
          <SectionHeader
            label="Judging"
            title={`${judgeRows.length} tournament${judgeRows.length === 1 ? '' : 's'}`}
          />
          <div className="panel hidden overflow-hidden md:block">
            <TableScroll>
              <Table className="w-full" label="Judging record by tournament">
                <thead>
                  <tr>
                    <Th className="w-[34%] pl-4">Tournament</Th>
                    <Th numeric>Year</Th>
                    <Th>Format</Th>
                    <Th numeric>Prelims chaired</Th>
                    <Th numeric>Prelims judged</Th>
                    <Th>Last outround chaired</Th>
                    <Th className="pr-4">Last outround judged</Th>
                  </tr>
                </thead>
                <tbody>
                  {judgeRows.map((r) => (
                    <Tr key={r.tournamentId.toString()}>
                      <Td className="pl-4">
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[44px] items-center font-medium text-ink hover:text-primary"
                        >
                          {r.tournamentName}
                        </a>
                      </Td>
                      <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                      <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                        {formatAbbrev(r.format) ?? <Nil />}
                      </Td>
                      <Td numeric>{r.inroundsChaired ?? <Nil />}</Td>
                      <Td numeric>{r.inroundsJudged ?? <Nil />}</Td>
                      <Td className="whitespace-nowrap">{r.lastOutroundChaired ?? <Nil />}</Td>
                      <Td className="whitespace-nowrap pr-4">
                        {r.lastOutroundJudged ?? <Nil />}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </div>

          <ul className="space-y-3 md:hidden">
            {judgeRows.map((r) => (
              <li key={r.tournamentId.toString()} className="panel p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block min-w-0 py-1 font-display text-h4 font-medium text-ink"
                  >
                    {r.tournamentName}
                  </a>
                  <span className="num shrink-0 text-caption text-ink-soft">{r.year ?? '—'}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                  {r.inroundsChaired != null ? (
                    <PublicField label="Prelims chaired" value={String(r.inroundsChaired)} mono />
                  ) : null}
                  {r.inroundsJudged != null ? (
                    <PublicField label="Prelims judged" value={String(r.inroundsJudged)} mono />
                  ) : null}
                  {r.lastOutroundChaired ? (
                    <PublicField label="Last outround chaired" value={r.lastOutroundChaired} />
                  ) : null}
                  {r.lastOutroundJudged ? (
                    <PublicField label="Last outround judged" value={r.lastOutroundJudged} />
                  ) : null}
                  {r.format ? <PublicField label="Format" value={r.format} /> : null}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="border-t border-border pt-4 text-caption text-ink-soft">
        Every row links to the tournament tab it was read from, at calicotab.com or
        herokuapp.com. Figures are as the tab published them.
      </p>
    </div>
  );
}

/**
 * One label/value pair inside a mobile record card. `truncate` on the value
 * with the full string in `title` keeps a long team or outround name from
 * blowing out the two-column grid.
 */
function PublicField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="data-label truncate">{label}</dt>
      <dd className={'mt-0.5 truncate text-table text-ink ' + (mono ? 'num' : '')} title={value}>
        {value}
      </dd>
    </div>
  );
}

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
