import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { buildCvData, type CvSpeakerRow } from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
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

  const data = await buildCvData(user.id);
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
    <div className="space-y-8">
      <header className="border-b border-border pb-6">
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
          <div className="panel overflow-hidden">
            <TableScroll>
              <Table className="min-w-max">
                <thead>
                  <tr>
                    <Th className="pl-4">Tournament</Th>
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
                            className="font-medium text-ink hover:text-primary"
                          >
                            {r.tournamentName}
                          </a>
                        </Td>
                        <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                        <Td className="whitespace-nowrap text-ink-soft">{r.format ?? <Nil />}</Td>
                        <Td className="text-ink">{r.teamName ?? <Nil />}</Td>
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
        </section>
      ) : null}

      {judgeRows.length > 0 ? (
        <section aria-label="Judging" className="space-y-3">
          <SectionHeader
            label="Judging"
            title={`${judgeRows.length} tournament${judgeRows.length === 1 ? '' : 's'}`}
          />
          <div className="panel overflow-hidden">
            <TableScroll>
              <Table className="min-w-max">
                <thead>
                  <tr>
                    <Th className="pl-4">Tournament</Th>
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
                          className="font-medium text-ink hover:text-primary"
                        >
                          {r.tournamentName}
                        </a>
                      </Td>
                      <Td numeric className="text-ink-soft">{r.year ?? <Nil />}</Td>
                      <Td className="whitespace-nowrap text-ink-soft">{r.format ?? <Nil />}</Td>
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
        </section>
      ) : null}

      <p className="border-t border-border pt-4 text-caption text-ink-soft">
        Every row links to the tournament tab it was read from, at calicotab.com or
        herokuapp.com. Figures are as the tab published them.
      </p>
    </div>
  );
}

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
