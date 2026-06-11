import { Trophy, Mic, GraduationCap, Gavel, Crown, Globe } from 'lucide-react';
import type { CvHighlights as CvHighlightsData } from '@/lib/cv/buildCvData';

/**
 * Auto-generated highlights reel: a 2- or 3-column flow on paper,
 * separated by hairlines, with primary-green kickers and upright Space
 * Grotesk titles. Highlight selection is driven entirely by `highlights`
 * from `buildCvData`; this component is presentation only.
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
    kicker: string;
    title: string;
    items: string[];
    icon: React.ReactNode;
  }> = [];

  if (championships.length > 0) {
    tiles.push({
      kicker: 'CHAMPIONSHIPS',
      title: `Champion (${championships.length})`,
      items: championships.map((c) => `${c.tournamentName}${c.year ? ` ${c.year}` : ''}`),
      icon: <Trophy className="h-4 w-4" aria-hidden />,
    });
  }
  if (topBreaks.length > 0) {
    tiles.push({
      kicker: 'DEEPEST BREAKS',
      title: `Top-10% break (${topBreaks.length})`,
      items: topBreaks.map(
        (b) =>
          `#${b.rank}/${b.totalTeams} · ${b.tournamentName}${b.year ? ` ${b.year}` : ''}`,
      ),
      icon: <Mic className="h-4 w-4" aria-hidden />,
    });
  }
  if (bestSpeakerRank) {
    tiles.push({
      kicker: 'BEST FORM',
      title: 'Best speaker rank',
      items: [
        `#${bestSpeakerRank.rank} · ${bestSpeakerRank.tournamentName}${bestSpeakerRank.year ? ` ${bestSpeakerRank.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-4 w-4" aria-hidden />,
    });
  }
  if (bestSpeakerAverage) {
    tiles.push({
      kicker: 'PEAK AVERAGE',
      title: 'Best speaker average',
      items: [
        `${bestSpeakerAverage.score.toFixed(1)} · ${bestSpeakerAverage.tournamentName}${bestSpeakerAverage.year ? ` ${bestSpeakerAverage.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-4 w-4" aria-hidden />,
    });
  }
  if (outroundsChaired > 0) {
    tiles.push({
      kicker: 'MOST CHAIRED',
      title: 'Outrounds chaired',
      items: [`${outroundsChaired} ${outroundsChaired === 1 ? 'outround' : 'outrounds'}`],
      icon: <Gavel className="h-4 w-4" aria-hidden />,
    });
  }
  if (adjCoreCount > 0) {
    tiles.push({
      kicker: 'ADJUDICATION CORE',
      title: 'Adj core',
      items: [`${adjCoreCount} ${adjCoreCount === 1 ? 'tournament' : 'tournaments'}`],
      icon: <Crown className="h-4 w-4" aria-hidden />,
    });
  }
  if (majorEvents.length > 0) {
    tiles.push({
      kicker: 'MAJOR CIRCUIT',
      title: `Major-circuit (${majorEvents.length})`,
      items: majorEvents.map((m) => `${m.tournamentName}${m.year ? ` ${m.year}` : ''}`),
      icon: <Globe className="h-4 w-4" aria-hidden />,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <section aria-label="Highlights">
      <header className="mb-6 max-w-2xl">
        <div className="kicker">HIGHLIGHTS</div>
        <h2 className="mt-3 font-display text-h2 font-semibold text-ink">
          What stands out on this record
        </h2>
      </header>

      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t, i) => (
          <article
            key={i}
            className="border-t border-ink/10 pt-4"
          >
            <div className="kicker flex items-center gap-1.5">
              <span className="text-primary">{t.icon}</span>
              {t.kicker}
            </div>
            <h3 className="mt-2 font-display text-h3 font-semibold text-ink">{t.title}</h3>
            <ul className="mt-1 space-y-0.5 text-body leading-relaxed text-ink/80">
              {t.items.map((item, j) => (
                <li key={j} className="break-words">{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
