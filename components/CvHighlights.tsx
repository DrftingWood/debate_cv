import { Trophy, Mic, GraduationCap, Gavel, Crown, Globe } from 'lucide-react';
import type { CvHighlights as CvHighlightsData } from '@/lib/cv/buildCvData';

/**
 * Auto-generated highlights reel — restyled as editorial "career notes"
 * (a 2- or 3-column flow on paper, separated by hairlines, with record-green
 * kickers and Fraunces titles). The selection logic is unchanged;
 * we only swap the presentation.
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
    eyebrow: string;
    title: string;
    items: string[];
    icon: React.ReactNode;
  }> = [];

  if (championships.length > 0) {
    tiles.push({
      eyebrow: 'CHAMPIONSHIPS',
      title: `Champion (${championships.length})`,
      items: championships.map((c) => `${c.tournamentName}${c.year ? ` ${c.year}` : ''}`),
      icon: <Trophy className="h-4 w-4" aria-hidden />,
    });
  }
  if (topBreaks.length > 0) {
    tiles.push({
      eyebrow: 'DEEPEST BREAKS',
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
      eyebrow: 'BEST FORM',
      title: 'Best speaker rank',
      items: [
        `#${bestSpeakerRank.rank} · ${bestSpeakerRank.tournamentName}${bestSpeakerRank.year ? ` ${bestSpeakerRank.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-4 w-4" aria-hidden />,
    });
  }
  if (bestSpeakerAverage) {
    tiles.push({
      eyebrow: 'PEAK AVERAGE',
      title: 'Best speaker average',
      items: [
        `${bestSpeakerAverage.score.toFixed(1)} · ${bestSpeakerAverage.tournamentName}${bestSpeakerAverage.year ? ` ${bestSpeakerAverage.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-4 w-4" aria-hidden />,
    });
  }
  if (outroundsChaired > 0) {
    tiles.push({
      eyebrow: 'MOST CHAIRED',
      title: 'Outrounds chaired',
      items: [`${outroundsChaired} ${outroundsChaired === 1 ? 'outround' : 'outrounds'}`],
      icon: <Gavel className="h-4 w-4" aria-hidden />,
    });
  }
  if (adjCoreCount > 0) {
    tiles.push({
      eyebrow: 'ADJUDICATION CORE',
      title: 'Adj core',
      items: [`${adjCoreCount} ${adjCoreCount === 1 ? 'tournament' : 'tournaments'}`],
      icon: <Crown className="h-4 w-4" aria-hidden />,
    });
  }
  if (majorEvents.length > 0) {
    tiles.push({
      eyebrow: 'MAJOR CIRCUIT',
      title: `Major-circuit (${majorEvents.length})`,
      items: majorEvents.map((m) => `${m.tournamentName}${m.year ? ` ${m.year}` : ''}`),
      icon: <Globe className="h-4 w-4" aria-hidden />,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <section aria-label="Career notes">
      <header className="mb-6 max-w-2xl">
        <div className="eyebrow">CAREER NOTES · HIGHLIGHTS</div>
        <h2 className="mt-3 font-display text-h2 text-record-ink">
          Notable moments.
        </h2>
      </header>

      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t, i) => (
          <article
            key={i}
            className="border-t border-record-ink/10 pt-4"
          >
            <div className="eyebrow flex items-center gap-1.5">
              <span className="text-record-green">{t.icon}</span>
              {t.eyebrow}
            </div>
            <h3 className="mt-2 font-display text-h3 text-record-ink">{t.title}</h3>
            <ul className="mt-1 space-y-0.5 font-display text-body leading-relaxed text-record-ink/80">
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
