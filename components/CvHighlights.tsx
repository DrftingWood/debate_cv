import { Trophy, Mic, GraduationCap, Gavel, Crown, Globe } from 'lucide-react';
import type { CvHighlights as CvHighlightsData } from '@/lib/cv/buildCvData';
import { SectionHeader } from '@/components/ui/Card';

/**
 * Auto-derived highlights, restyled as statement "positions": a compact
 * grid of hairline-bounded cards, each with a mono label, an icon, the
 * headline claim, and the tournaments backing it. The selection logic is
 * unchanged — only the presentation moved from editorial career notes to
 * the ledger register.
 */
export function CvHighlights({ highlights }: { highlights: CvHighlightsData }) {
  const {
    championships,
    topBreaks,
    bestSpeakerRank,
    bestSpeakerAverage,
    outroundsChaired,
    adjCoreCount,
    majorEvents,
  } = highlights;

  const tiles: Array<{
    label: string;
    title: string;
    items: string[];
    icon: React.ReactNode;
    gold?: boolean;
  }> = [];

  if (championships.length > 0) {
    tiles.push({
      label: 'Championships',
      title: `Won ${championships.length} ${championships.length === 1 ? 'title' : 'titles'}`,
      items: championships.map((c) => `${c.tournamentName}${c.year ? ` ${c.year}` : ''}`),
      icon: <Trophy className="h-3.5 w-3.5" aria-hidden />,
      gold: true,
    });
  }
  if (topBreaks.length > 0) {
    tiles.push({
      label: 'Deepest breaks',
      title: `Top-10% break × ${topBreaks.length}`,
      items: topBreaks.map(
        (b) => `#${b.rank} of ${b.totalTeams} · ${b.tournamentName}${b.year ? ` ${b.year}` : ''}`,
      ),
      icon: <Mic className="h-3.5 w-3.5" aria-hidden />,
      gold: true,
    });
  }
  if (bestSpeakerRank) {
    tiles.push({
      label: 'Best speaker rank',
      title: `#${bestSpeakerRank.rank}`,
      items: [
        `${bestSpeakerRank.tournamentName}${bestSpeakerRank.year ? ` ${bestSpeakerRank.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-3.5 w-3.5" aria-hidden />,
    });
  }
  if (bestSpeakerAverage) {
    tiles.push({
      label: 'Peak average',
      title: bestSpeakerAverage.score.toFixed(1),
      items: [
        `${bestSpeakerAverage.tournamentName}${bestSpeakerAverage.year ? ` ${bestSpeakerAverage.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-3.5 w-3.5" aria-hidden />,
    });
  }
  if (outroundsChaired > 0) {
    tiles.push({
      label: 'Outrounds chaired',
      title: String(outroundsChaired),
      items: [`${outroundsChaired === 1 ? 'Tournament' : 'Tournaments'} with an outround chair`],
      icon: <Gavel className="h-3.5 w-3.5" aria-hidden />,
    });
  }
  if (adjCoreCount > 0) {
    tiles.push({
      label: 'Adjudication core',
      title: `${adjCoreCount}×`,
      items: [`${adjCoreCount === 1 ? 'Tournament' : 'Tournaments'} on the adj core`],
      icon: <Crown className="h-3.5 w-3.5" aria-hidden />,
    });
  }
  if (majorEvents.length > 0) {
    tiles.push({
      label: 'Major circuit',
      title: `${majorEvents.length} ${majorEvents.length === 1 ? 'major' : 'majors'}`,
      items: majorEvents.map((m) => `${m.tournamentName}${m.year ? ` ${m.year}` : ''}`),
      icon: <Globe className="h-3.5 w-3.5" aria-hidden />,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <section aria-label="Highlights" className="space-y-3">
      <SectionHeader label="Highlights" title="Standout results" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t, i) => (
          <article key={i} className="panel p-4">
            <div className="data-label flex items-center gap-1.5">
              <span className={t.gold ? 'text-break-gold' : 'text-primary'}>{t.icon}</span>
              {t.label}
            </div>
            <h3
              className={
                'figure mt-2 text-figure-sm ' + (t.gold ? 'text-break-gold' : 'text-ink')
              }
            >
              {t.title}
            </h3>
            <ul className="mt-2 space-y-1 text-caption leading-relaxed text-ink-soft">
              {t.items.map((item, j) => (
                <li key={j} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
