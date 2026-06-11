import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { buildCvData, type CvSpeakerRow } from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { CvHighlights } from '@/components/CvHighlights';
import { DownloadPdfButton } from '@/components/DownloadPdfButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatBlock } from '@/components/ui/StatBlock';
import { BreakMarker } from '@/components/ui/BreakMarker';
import { ResultLine } from '@/components/ui/ResultLine';
import { cn } from '@/lib/utils/cn';

function fmtPublicLastOutround(r: CvSpeakerRow): string {
  if (r.eliminationReachedByCategory && r.eliminationReachedByCategory.length > 1) {
    const joined = r.eliminationReachedByCategory
      .map((e) => `${e.category}: ${formatStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (Champion)` : joined;
  }
  if (!r.eliminationReached) return '—';
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
    title: `${user.name ?? 'Debater'} · Debate CV`,
    description: `${user.name ?? 'A debater'}'s verified tournament record.`,
    robots: { index: false, follow: false, nocache: true },
  };
}

/**
 * Public read-only CV view (`/u/<slug>`). Credential-ordered (teardown
 * §2.4): a selector arriving from a LinkedIn or WhatsApp link must absorb
 * the headline facts — name, tournaments, breaks, best average — in one
 * screen without scrolling. All owner-only affordances stay stripped: no
 * Report buttons, no banners, no Share/Settings links, no auto-scan.
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

  // Headline facts, best-first, capped at four. Judges without speaker
  // stats fall back to chairing depth so the block never sits half-empty.
  const stats: { label: string; value: string }[] = [];
  stats.push({ label: 'Tournaments', value: String(summary.totalTournaments) });
  if (summary.breaks > 0) stats.push({ label: 'Breaks', value: String(summary.breaks) });
  if (highlights.bestSpeakerAverage)
    stats.push({ label: 'Best avg', value: highlights.bestSpeakerAverage.score.toFixed(1) });
  if (highlights.bestSpeakerRank)
    stats.push({ label: 'Best speaker', value: `#${highlights.bestSpeakerRank.rank}` });
  if (stats.length < 4 && highlights.outroundsChaired > 0)
    stats.push({ label: 'Outrounds chaired', value: String(highlights.outroundsChaired) });
  const statBlocks = stats.slice(0, 4);

  return (
    <div className="space-y-12">
      {/* Credential masthead */}
      <header className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="eyebrow">
            Debate CV — public record · compiled{' '}
            {new Date().toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </div>
          <div data-print-hide="true">
            <DownloadPdfButton />
          </div>
        </div>

        <div className="flex items-end gap-5">
          {user.publicAvatarEnabled && user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? 'Debater'}
              className="h-16 w-16 rounded-sm border border-record-ink/20 object-cover"
            />
          ) : null}
          <h1 className="display-expanded font-display text-h1 font-bold leading-[1.05] tracking-tight text-record-ink md:text-display">
            {user.name ?? 'Debater'}
          </h1>
        </div>

        <div
          className={cn(
            'grid grid-cols-2 gap-x-6 gap-y-5 pt-2',
            // Static map — Tailwind's JIT can't see interpolated class names.
            { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[
              Math.min(Math.max(statBlocks.length, 1), 4)
            ],
          )}
        >
          {statBlocks.map((s) => (
            <StatBlock key={s.label} label={s.label} value={s.value} />
          ))}
        </div>

        <p className="meta">
          Verified via tournament tab links{highlights.activeYears ? ` · active ${highlights.activeYears.from}–${String(highlights.activeYears.to).slice(2)}` : ''} · source: calicotab.com · herokuapp.com
        </p>
      </header>

      <CvHighlights highlights={highlights} />

      {speakerRows.length > 0 ? (
        <section aria-label="Speaking" className="space-y-0">
          <SectionHeader title="Speaking" count={speakerRows.length} />

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-max text-table">
              <thead>
                <tr className="border-b border-record-rule/50 text-left">
                  {['Tournament', 'Year', 'Format', 'Team', 'Team rank', 'Spk rank', 'Avg', 'Outround'].map((h) => (
                    <th key={h} className="data-label px-3 py-2.5 first:pl-0 last:pr-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {speakerRows.map((r) => (
                  <tr
                    key={r.tournamentId.toString()}
                    className={cn('border-b border-record-rule/40', r.broke && 'border-l-2 border-l-break-gold')}
                  >
                    <td className={cn('px-3 py-2.5 font-semibold', r.broke ? 'pl-3' : 'pl-0')}>
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-record-ink hover:text-record-green"
                      >
                        {r.tournamentName}
                      </a>
                    </td>
                    <td className="num px-3 py-2.5 text-record-muted">{r.year ?? '—'}</td>
                    <td className="px-3 py-2.5 text-record-muted">{r.format ?? '—'}</td>
                    <td className="px-3 py-2.5 text-record-ink">{r.teamName ?? '—'}</td>
                    <td className="num px-3 py-2.5 text-record-ink">
                      {r.teamRank != null ? `#${r.teamRank}` : '—'}
                    </td>
                    <td className="num px-3 py-2.5 text-record-muted">
                      {r.speakerRankOpen != null ? `#${r.speakerRankOpen}` : '—'}
                    </td>
                    <td className="num px-3 py-2.5 text-record-ink">{r.speakerAvgScore ?? '—'}</td>
                    <td className="px-3 py-2.5 pr-0">
                      {r.broke ? (
                        <BreakMarker>{fmtPublicLastOutround(r)}</BreakMarker>
                      ) : (
                        <span className="text-record-muted">{fmtPublicLastOutround(r)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {speakerRows.map((r) => (
              <ResultLine
                key={r.tournamentId.toString()}
                title={r.tournamentName}
                meta={r.year ?? undefined}
                broke={r.broke}
                data={
                  <span>
                    {r.teamRank != null ? `#${r.teamRank}` : '—'}
                    {r.speakerAvgScore != null ? ` · ${r.speakerAvgScore} avg` : ''}
                    {r.speakerRankOpen != null ? ` · #${r.speakerRankOpen} spk` : ''}
                  </span>
                }
                result={r.broke ? <BreakMarker>{fmtPublicLastOutround(r)}</BreakMarker> : undefined}
              />
            ))}
          </div>
        </section>
      ) : null}

      {judgeRows.length > 0 ? (
        <section aria-label="Judging" className="space-y-0">
          <SectionHeader title="Judging" count={judgeRows.length} />

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-max text-table">
              <thead>
                <tr className="border-b border-record-rule/50 text-left">
                  {['Tournament', 'Year', 'Format', 'Prelims chaired', 'Prelims judged', 'Last outround chaired', 'Last outround judged'].map((h) => (
                    <th key={h} className="data-label px-3 py-2.5 first:pl-0 last:pr-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {judgeRows.map((r) => (
                  <tr key={r.tournamentId.toString()} className="border-b border-record-rule/40">
                    <td className="px-3 py-2.5 pl-0 font-semibold">
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-record-ink hover:text-record-green"
                      >
                        {r.tournamentName}
                      </a>
                    </td>
                    <td className="num px-3 py-2.5 text-record-muted">{r.year ?? '—'}</td>
                    <td className="px-3 py-2.5 text-record-muted">{r.format ?? '—'}</td>
                    <td className="num px-3 py-2.5 text-record-ink">{r.inroundsChaired ?? '—'}</td>
                    <td className="num px-3 py-2.5 text-record-ink">{r.inroundsJudged ?? '—'}</td>
                    <td className="px-3 py-2.5 text-record-muted">{r.lastOutroundChaired ?? '—'}</td>
                    <td className="px-3 py-2.5 pr-0 text-record-muted">{r.lastOutroundJudged ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {judgeRows.map((r) => (
              <ResultLine
                key={r.tournamentId.toString()}
                title={r.tournamentName}
                meta={r.year ?? undefined}
                data={
                  <span>
                    {r.inroundsJudged != null ? `${r.inroundsJudged} prelims` : '—'}
                    {r.inroundsChaired != null ? ` · ${r.inroundsChaired} chaired` : ''}
                    {r.lastOutroundChaired ? ` · ${r.lastOutroundChaired} chair` : ''}
                  </span>
                }
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
