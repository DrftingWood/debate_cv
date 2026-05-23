import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { buildCvData, type CvSpeakerRow } from '@/lib/cv/buildCvData';
import { CvHighlights } from '@/components/CvHighlights';
import { DownloadPdfButton } from '@/components/DownloadPdfButton';

function fmtPublicLastOutround(r: CvSpeakerRow): string {
  if (r.eliminationReachedByCategory && r.eliminationReachedByCategory.length > 1) {
    const joined = r.eliminationReachedByCategory
      .map((e) => `${e.category}: ${e.stage}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (Champion)` : joined;
  }
  if (!r.eliminationReached) return '—';
  return r.wonTournament === true
    ? `${r.eliminationReached} (Champion)`
    : r.eliminationReached;
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
      {/* Public CV masthead — formal mode */}
      <header className="space-y-4">
        <div className="kicker">
          DEBATE CV — PUBLIC RECORD · COMPILED{' '}
          {new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).toUpperCase()}
        </div>

        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-end gap-5">
            {user.publicAvatarEnabled && user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name ?? 'Debater'}
                className="h-20 w-20 rounded border border-ink/20 object-cover"
              />
            ) : (
              <div
                role="img"
                aria-label={`${user.name ?? 'Debater'} initials`}
                className="flex h-20 w-20 items-center justify-center rounded border border-ink/20 bg-paper font-serif italic text-[26px] text-ink"
              >
                {initials(user.name)}
              </div>
            )}
            <h1 className="font-serif text-h1 italic leading-[1.05] tracking-tight text-ink md:text-display">
              {user.name ?? 'Debater'}.
            </h1>
          </div>
          <div data-print-hide="true">
            <DownloadPdfButton />
          </div>
        </div>

        <hr className="hairline" />

        <div className="byline uppercase tracking-[0.16em] text-byline text-ink-soft">
          {spellOrCount(totalIngestedTournaments)} tournament{totalIngestedTournaments === 1 ? '' : 's'} · verified via private URLs
          {summary.totalTournaments > 0 && summary.totalTournaments !== totalIngestedTournaments
            ? ` · ${summary.totalTournaments} on record`
            : ''}
        </div>
      </header>

      <CvHighlights highlights={highlights} />

      {speakerRows.length > 0 ? (
        <section aria-label="Speaking" className="space-y-4">
          <header>
            <div className="kicker">I · SPEAKING — {speakerRows.length} TOURNAMENT{speakerRows.length === 1 ? '' : 'S'}</div>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-max text-table">
              <thead className="border-y border-ink/15 uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 text-left">Tournament</th>
                  <th className="px-4 py-2.5 text-left">Year</th>
                  <th className="px-4 py-2.5 text-left">Format</th>
                  <th className="px-4 py-2.5 text-left">Team</th>
                  <th className="px-4 py-2.5 text-left">Team rank</th>
                  <th className="px-4 py-2.5 text-left">Speaker rank</th>
                  <th className="px-4 py-2.5 text-left">Avg score</th>
                  <th className="px-4 py-2.5 text-left">Outround</th>
                </tr>
              </thead>
              <tbody>
                {speakerRows.map((r) => (
                  <tr key={r.tournamentId.toString()} className="border-b border-ink/10">
                    <td className="px-4 py-2.5">
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-serif italic text-ink hover:text-oxblood"
                      >
                        {r.tournamentName}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft num">{r.year ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{r.format ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink">{r.teamName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft num">
                      {r.teamRank != null ? `#${r.teamRank}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft num">
                      {r.speakerRankOpen != null ? `#${r.speakerRankOpen}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft num">{r.speakerAvgScore ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{fmtPublicLastOutround(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-serif italic text-byline text-ink-soft">
            Source: tournament tabs at calicotab.com · herokuapp.com.
          </p>
        </section>
      ) : null}

      {judgeRows.length > 0 ? (
        <section aria-label="Judging" className="space-y-4">
          <header>
            <div className="kicker">II · JUDGING — {judgeRows.length} TOURNAMENT{judgeRows.length === 1 ? '' : 'S'}</div>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-max text-table">
              <thead className="border-y border-ink/15 uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 text-left">Tournament</th>
                  <th className="px-4 py-2.5 text-left">Year</th>
                  <th className="px-4 py-2.5 text-left">Format</th>
                  <th className="px-4 py-2.5 text-left">Prelims chaired</th>
                  <th className="px-4 py-2.5 text-left">Prelims judged</th>
                  <th className="px-4 py-2.5 text-left">Last outround chaired</th>
                  <th className="px-4 py-2.5 text-left">Last outround judged</th>
                </tr>
              </thead>
              <tbody>
                {judgeRows.map((r) => (
                  <tr key={r.tournamentId.toString()} className="border-b border-ink/10">
                    <td className="px-4 py-2.5">
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-serif italic text-ink hover:text-oxblood"
                      >
                        {r.tournamentName}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft num">{r.year ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{r.format ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft num">{r.inroundsChaired ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft num">{r.inroundsJudged ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{r.lastOutroundChaired ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{r.lastOutroundJudged ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-serif italic text-byline text-ink-soft">
            Source: tournament tabs at calicotab.com · herokuapp.com.
          </p>
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

function spellOrCount(n: number): string {
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
  return n < 20 ? (words[n] ?? String(n)) : String(n);
}
