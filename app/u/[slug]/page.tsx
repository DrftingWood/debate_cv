import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import { Badge } from '@/components/ui/Badge';
import { CvHighlights } from '@/components/CvHighlights';
import { DownloadPdfButton } from '@/components/DownloadPdfButton';

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
 * Public read-only CV view (`/u/<slug>`). Same data shape as the owner
 * `/cv` view, but with all owner-only affordances stripped: no Report
 * buttons, no banners, no Share/Settings links, no per-row "Reported"
 * badges, no auto-scan. Uses CvHighlights as the headline + a static
 * profile header + the Speaking/Judging tables (rendered inline rather
 * than via the owner-side CollapsibleSection so the public artifact
 * prints cleanly).
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
  const totalIngestedTournaments = await prisma.discoveredUrl.count({
    where: { userId: user.id, ingestedAt: { not: null } },
  });

  return (
    <div className="space-y-10">
      {/* Profile header — minimal, no email, no metric tiles. */}
      <header className="flex flex-col items-start gap-4 md:flex-row md:items-center md:gap-6">
        {user.publicAvatarEnabled && user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt={user.name ?? 'Debater'}
            className="h-20 w-20 rounded-full border border-border object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-accent font-display text-[24px] font-semibold text-white">
            {initials(user.name)}
          </div>
        )}
        <div className="flex-1 space-y-2">
          <h1 className="font-display text-h1 font-semibold tracking-tight text-foreground">
            {user.name ?? 'Debater'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
            <Badge variant="success">
              <Trophy className="mr-1 h-3 w-3" aria-hidden />
              {totalIngestedTournaments} ingested via private URLs
            </Badge>
            {summary.totalTournaments > 0 ? (
              <span>· {summary.totalTournaments} tournaments</span>
            ) : null}
          </div>
        </div>
        <div data-print-hide="true">
          <DownloadPdfButton />
        </div>
      </header>

      <CvHighlights highlights={highlights} />

      {speakerRows.length > 0 ? (
        <section aria-label="Speaking">
          <h2 className="mb-3 font-display text-h3 font-semibold text-foreground">
            Speaking ({speakerRows.length})
          </h2>
          <div className="overflow-x-auto rounded-card border border-border bg-card">
            <table className="min-w-max text-[13px]">
              <thead className="border-b border-border bg-muted/60 text-left text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Tournament</th>
                  <th className="px-4 py-2.5">Year</th>
                  <th className="px-4 py-2.5">Format</th>
                  <th className="px-4 py-2.5">Team</th>
                  <th className="px-4 py-2.5">Team rank</th>
                  <th className="px-4 py-2.5">Speaker rank</th>
                  <th className="px-4 py-2.5">Avg score</th>
                  <th className="px-4 py-2.5">Outround</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {speakerRows.map((r) => (
                  <tr key={r.tournamentId.toString()}>
                    <td className="px-4 py-2.5 text-foreground">{r.tournamentName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.year ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.format ?? '—'}</td>
                    <td className="px-4 py-2.5 text-foreground">{r.teamName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.teamRank != null ? `#${r.teamRank}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.speakerRankOpen != null ? `#${r.speakerRankOpen}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">
                      {r.speakerAvgScore ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.eliminationReached
                        ? r.wonTournament
                          ? `${r.eliminationReached} (Champion)`
                          : r.eliminationReached
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {judgeRows.length > 0 ? (
        <section aria-label="Judging">
          <h2 className="mb-3 font-display text-h3 font-semibold text-foreground">
            Judging ({judgeRows.length})
          </h2>
          <div className="overflow-x-auto rounded-card border border-border bg-card">
            <table className="min-w-max text-[13px]">
              <thead className="border-b border-border bg-muted/60 text-left text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Tournament</th>
                  <th className="px-4 py-2.5">Year</th>
                  <th className="px-4 py-2.5">Format</th>
                  <th className="px-4 py-2.5">Prelims chaired</th>
                  <th className="px-4 py-2.5">Prelims judged</th>
                  <th className="px-4 py-2.5">Last outround chaired</th>
                  <th className="px-4 py-2.5">Last outround judged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {judgeRows.map((r) => (
                  <tr key={r.tournamentId.toString()}>
                    <td className="px-4 py-2.5 text-foreground">{r.tournamentName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.year ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.format ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">
                      {r.inroundsChaired ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">
                      {r.inroundsJudged ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.lastOutroundChaired ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.lastOutroundJudged ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
