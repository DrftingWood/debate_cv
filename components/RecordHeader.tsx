import { StatRow, StatTile } from '@/components/ui/StatTile';
import { CountUp } from '@/components/ui/CountUp';
import { CareerChart } from '@/components/ui/CareerChart';
import { CollapsibleCharts } from '@/components/CollapsibleCharts';
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
  countUp = false,
  collapsible = false,
}: {
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  summary: {
    tournamentsSpoken: number;
    speakingBreaks: number;
    tournamentsJudged: number;
    judgingBreaks: number;
  };
  /**
   * Count the four figures up once per session (decision 23). The Record
   * does; the public CV does not, as a credential it stays still (§3.6).
   */
  countUp?: boolean;
  /**
   * The charts fold behind "Show career charts" (owner, 2026-10-29), so the
   * Record's ledger starts above the fold. The public CV and /sample keep
   * them open: there the charts are the point.
   */
  collapsible?: boolean;
}) {
  const fig = (value: number, id: string) =>
    countUp ? <CountUp value={value} id={`record-${id}`} /> : value;
  const speaks = summary.tournamentsSpoken > 0;
  const judges = summary.tournamentsJudged > 0;
  if (!speaks && !judges) return null;
  // Tiles and charts are two rows on the same two-column grid, so each tile
  // pair still sits over its chart, and the charts can fold away as one.
  // 16 px between the stacked role rows on a phone, 32 px side by side.
  const grid = speaks && judges ? 'grid gap-stack lg:grid-cols-2 lg:gap-group' : undefined;
  const tiles = (
    <div className={grid}>
      {speaks ? (
        <StatRow columns={2}>
          <StatTile
            label="Spoke"
            value={fig(summary.tournamentsSpoken, 'spoke')}
            hint="tournaments"
          />
          <StatTile
            label="Broke"
            value={fig(summary.speakingBreaks, 'broke')}
            hint={`${percent(summary.speakingBreaks, summary.tournamentsSpoken)} of ${summary.tournamentsSpoken} spoken`}
          />
        </StatRow>
      ) : null}
      {judges ? (
        <StatRow columns={2}>
          <StatTile
            label="Judged"
            value={fig(summary.tournamentsJudged, 'judged')}
            hint="tournaments"
          />
          <StatTile
            label="Outrounds judged"
            value={fig(summary.judgingBreaks, 'outrounds')}
            hint={`${percent(summary.judgingBreaks, summary.tournamentsJudged)} of ${summary.tournamentsJudged} judged`}
          />
        </StatRow>
      ) : null}
    </div>
  );
  const charts = (
    <div className={grid}>
      {speaks ? (
        <CareerChart
          kind="speaking"
          title="Speaking, by year"
          series={speakingSeries(speakerRows)}
        />
      ) : null}
      {judges ? (
        <CareerChart
          kind="judging"
          title="Judging, by year"
          series={judgingSeries(judgeRows)}
          yearAnchor="j"
        />
      ) : null}
    </div>
  );
  return (
    <section aria-label="Speaking and judging at a glance" className="space-y-stack">
      {tiles}
      {collapsible ? <CollapsibleCharts>{charts}</CollapsibleCharts> : charts}
    </section>
  );
}

function percent(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : '0%';
}
