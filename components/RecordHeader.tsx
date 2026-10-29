import { StatRow, StatTile } from '@/components/ui/StatTile';
import { CareerChart } from '@/components/ui/CareerChart';
import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { judgingSeries, speakingSeries } from '@/lib/cv/careerChart';

/**
 * The Record header's figures (redesign, owner decisions 5, 12 and 13,
 * 2026-10-29): two tiles per role, each pair above its career chart,
 * Speaking on the left and Judging on the right (stacked on a phone,
 * Speaking first). Speaking breaks and judging breaks stay two numbers
 * (owner rule 2026-10-27), never one combined count.
 *
 * A role the user has no tournaments in is left out rather than shown as
 * zeros, the same rule the old header tiles kept: a pure judge is never told
 * "Spoke 0". With one role left it takes the full width.
 *
 * Shared by the Record and the public CV, which show the same header.
 */
export function RecordHeader({
  speakerRows,
  judgeRows,
  summary,
}: {
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  summary: {
    tournamentsSpoken: number;
    speakingBreaks: number;
    tournamentsJudged: number;
    judgingBreaks: number;
  };
}) {
  const roles = [
    summary.tournamentsSpoken > 0 ? (
      <div key="speaking" className="min-w-0 space-y-stack">
        <StatRow columns={2}>
          <StatTile label="Spoke" value={summary.tournamentsSpoken} hint="tournaments" />
          <StatTile
            label="Broke"
            value={summary.speakingBreaks}
            hint={`${percent(summary.speakingBreaks, summary.tournamentsSpoken)} of ${summary.tournamentsSpoken} spoken`}
          />
        </StatRow>
        <CareerChart
          kind="speaking"
          title="Speaking, by year"
          series={speakingSeries(speakerRows)}
        />
      </div>
    ) : null,
    summary.tournamentsJudged > 0 ? (
      <div key="judging" className="min-w-0 space-y-stack">
        <StatRow columns={2}>
          <StatTile label="Judged" value={summary.tournamentsJudged} hint="tournaments" />
          <StatTile
            label="Outrounds judged"
            value={summary.judgingBreaks}
            hint={`${percent(summary.judgingBreaks, summary.tournamentsJudged)} of ${summary.tournamentsJudged} judged`}
          />
        </StatRow>
        <CareerChart
          kind="judging"
          title="Judging, by year"
          series={judgingSeries(judgeRows)}
          yearAnchor="j"
        />
      </div>
    ) : null,
  ].filter(Boolean);
  if (roles.length === 0) return null;
  return (
    <section
      aria-label="Speaking and judging at a glance"
      className={roles.length === 2 ? 'grid gap-group lg:grid-cols-2' : undefined}
    >
      {roles}
    </section>
  );
}

function percent(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : '0%';
}
