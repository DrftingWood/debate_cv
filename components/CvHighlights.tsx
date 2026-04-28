import { Trophy, Sparkles, Mic, Gavel, GraduationCap, Globe } from 'lucide-react';
import type { CvHighlights as CvHighlightsData } from '@/lib/cv/buildCvData';

/**
 * Auto-generated highlights reel rendered above the Speaking + Judging
 * tables on /cv (and /u/<slug> when public sharing ships). Tiles are
 * derived from already-ingested data — no user curation, so the public
 * CV stays trustworthy. Tiles hide entirely when the underlying value
 * is zero/null; the whole component returns null if every tile is empty.
 */
export function CvHighlights({ highlights }: { highlights: CvHighlightsData }) {
  const {
    championships,
    topBreaks,
    bestSpeakerRank,
    bestSpeakerAverage,
    outroundsChaired,
    majorEvents,
  } = highlights;

  const hasAnything =
    championships.length > 0 ||
    topBreaks.length > 0 ||
    bestSpeakerRank != null ||
    bestSpeakerAverage != null ||
    outroundsChaired > 0 ||
    majorEvents.length > 0;
  if (!hasAnything) return null;

  return (
    <section
      aria-label="Highlights"
      className="rounded-card border border-border bg-card p-5 md:p-6"
    >
      <header className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="font-display text-h4 font-semibold text-foreground">
          Highlights
        </h2>
      </header>
      <ul className="grid gap-3 md:grid-cols-2">
        {championships.length > 0 ? (
          <Tile
            icon={<Trophy className="h-4 w-4" aria-hidden />}
            label={`Champion (${championships.length})`}
            items={championships.map(
              (c) => `${c.tournamentName}${c.year ? ` ${c.year}` : ''}`,
            )}
          />
        ) : null}
        {topBreaks.length > 0 ? (
          <Tile
            icon={<Mic className="h-4 w-4" aria-hidden />}
            label={`Top-10% break (${topBreaks.length})`}
            items={topBreaks.map(
              (b) =>
                `#${b.rank}/${b.totalTeams} · ${b.tournamentName}${b.year ? ` ${b.year}` : ''}`,
            )}
          />
        ) : null}
        {bestSpeakerRank ? (
          <Tile
            icon={<GraduationCap className="h-4 w-4" aria-hidden />}
            label="Best speaker rank"
            items={[
              `#${bestSpeakerRank.rank} · ${bestSpeakerRank.tournamentName}${bestSpeakerRank.year ? ` ${bestSpeakerRank.year}` : ''}`,
            ]}
          />
        ) : null}
        {bestSpeakerAverage ? (
          <Tile
            icon={<GraduationCap className="h-4 w-4" aria-hidden />}
            label="Best speaker average"
            items={[
              `${bestSpeakerAverage.score.toFixed(1)} · ${bestSpeakerAverage.tournamentName}${bestSpeakerAverage.year ? ` ${bestSpeakerAverage.year}` : ''}`,
            ]}
          />
        ) : null}
        {outroundsChaired > 0 ? (
          <Tile
            icon={<Gavel className="h-4 w-4" aria-hidden />}
            label="Outrounds chaired"
            items={[`${outroundsChaired} ${outroundsChaired === 1 ? 'outround' : 'outrounds'}`]}
          />
        ) : null}
        {majorEvents.length > 0 ? (
          <Tile
            icon={<Globe className="h-4 w-4" aria-hidden />}
            label={`Major-circuit (${majorEvents.length})`}
            items={majorEvents.map(
              (m) => `${m.tournamentName}${m.year ? ` ${m.year}` : ''}`,
            )}
          />
        ) : null}
      </ul>
    </section>
  );
}

function Tile({
  icon,
  label,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
}) {
  return (
    <li className="rounded-md border border-border bg-muted/30 p-3.5">
      <div className="mb-1 inline-flex items-center gap-1.5 text-caption font-medium text-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <ul className="space-y-0.5 text-[13px] text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </li>
  );
}
