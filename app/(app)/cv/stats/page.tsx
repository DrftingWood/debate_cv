import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Info } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import { computeSpeakerStats } from '@/lib/cv/speakerStats';
import type { SpeakerStats } from '@/lib/cv/speakerStats';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { TrendChart } from '@/components/ui/TrendChart';
import { BarList, Meter, Histogram } from '@/components/ui/BarList';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import { StatsSplitTable } from '@/components/StatsSplitTable';
import { CvSubNav } from '@/components/CvSubNav';
import { PageJumpNav } from '@/components/PageJumpNav';

export const metadata: Metadata = {
  title: 'Statistics',
  description: 'Your speaker record measured against itself and against the field.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

// Order matches the render order below. Labels are shorter than the section
// headings on purpose — this is a rail, not a table of contents.
const STATS_SECTIONS = [
  { id: 'headline', label: 'Headline' },
  { id: 'findings', label: 'Findings' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'field', label: 'Field' },
  { id: 'dynamics', label: 'Across a draw' },
  { id: 'results', label: 'Results' },
  { id: 'splits', label: 'Splits' },
  { id: 'partners', label: 'Partners' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'coverage', label: 'Coverage' },
];

/**
 * The analysis surface — everything the record implies but doesn't say.
 *
 * Ordered the way a debater actually reads their own numbers: what is my
 * level, how consistent am I, how did I place against the people in the
 * room, what happens across a tournament, and finally the splits that say
 * where the wins and losses concentrate. Every block carries the sample it
 * rests on, and nothing here interprets style — see the header note in
 * lib/cv/speakerStats.ts for the rules this page is built to.
 */
export default async function CvStatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  // Same gate as /cv — an unclaimed user has no rows to compute over.
  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: session.user.id },
  });
  if (claimedCount === 0) redirect('/onboarding');

  const data = await buildCvData(session.user.id);
  const stats = computeSpeakerStats(data);
  const { scoreProfile, results, volume, coverage } = stats;

  const hasAnything =
    scoreProfile.speeches > 0 ||
    results.decidedRounds > 0 ||
    stats.seasons.length > 0 ||
    stats.judgingSeasons.length > 0;

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-6">
        <div className="data-label">Statistics</div>
        <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
          Your record, measured
        </h1>
        <p className="mt-2 max-w-2xl text-body text-ink-soft">
          Built from {volume.speechesScored.toLocaleString()} scored speeches across{' '}
          {volume.tournamentsSpoken} tournament{volume.tournamentsSpoken === 1 ? '' : 's'}. Every
          figure is computed from the tab pages themselves — nothing here is an estimate or an
          interpretation of style.
        </p>
      </header>

      <CvSubNav active="stats" />

      {!hasAnything ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" aria-hidden />}
          title="Not enough data yet"
          description="Statistics appear once at least one tournament with parsed results is on your record. Ingest tournaments from Imports first."
          action={
            <Link href="/dashboard">
              <Button variant="primary">Open imports</Button>
            </Link>
          }
        />
      ) : (
        /*
          Eight screens of analysis on desktop, eleven on a phone, and before
          this the only way to reach the partner table was to scroll past
          everything else. The rail becomes a sidebar from lg up and a
          horizontal strip below it.
        */
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10">
          <div className="space-y-10 lg:order-1">
            <HeadlineStats stats={stats} />
            <Quirks stats={stats} />
            <ScoreDistribution stats={stats} />
            <FieldStanding stats={stats} />
            <RoundDynamicsSection stats={stats} />
            <ResultsSection stats={stats} />
            <Splits stats={stats} />
            <Partners stats={stats} />
            <SeasonTrends seasons={stats.seasons} judging={stats.judgingSeasons} />
            <Coverage coverage={coverage} />
          </div>
          <PageJumpNav className="mb-6 lg:order-2 lg:mb-0" targets={STATS_SECTIONS} />
        </div>
      )}
    </div>
  );
}

// ── Headline ──────────────────────────────────────────────────────────────

function HeadlineStats({ stats }: { stats: SpeakerStats }) {
  const { scoreProfile, fieldContext, results, volume } = stats;
  const tiles: React.ReactNode[] = [];

  if (scoreProfile.mean != null) {
    tiles.push(
      <StatTile
        key="mean"
        label="Career speaker average"
        value={scoreProfile.mean.toFixed(1)}
        hint={`${scoreProfile.speeches} scored speeches`}
      />,
    );
  }
  if (scoreProfile.stdev != null) {
    tiles.push(
      <StatTile
        key="stdev"
        label="Consistency (σ)"
        value={scoreProfile.stdev.toFixed(2)}
        hint="Lower means your speeches cluster tighter"
      />,
    );
  }
  if (fieldContext.meanPercentile != null) {
    tiles.push(
      <StatTile
        key="pct"
        label="Average tab placement"
        value={`Top ${Math.round(100 - fieldContext.meanPercentile)}%`}
        accent="blue"
        hint={`Across ${fieldContext.placements.length} tournaments · ${fieldContext.speakersFaced.toLocaleString()} speakers`}
      />,
    );
  }
  if (results.winRate != null) {
    tiles.push(
      <StatTile
        key="win"
        label="Round win rate"
        value={`${Math.round(results.winRate * 100)}%`}
        hint={`${results.wins} of ${results.decidedRounds} decided rounds`}
      />,
    );
  }
  if (results.breakRate != null) {
    tiles.push(
      <StatTile
        key="break"
        label="Break rate"
        value={`${Math.round(results.breakRate * 100)}%`}
        accent="gold"
        hint={`${results.breaks} of ${results.tournamentsSpoken} entries`}
      />,
    );
  }
  if (tiles.length === 0) {
    tiles.push(
      <StatTile
        key="rounds"
        label="Rounds debated"
        value={volume.roundsDebated}
        hint={`${volume.tournamentsSpoken} tournaments`}
      />,
    );
  }

  return (
    <section id="headline" aria-label="Headline figures" className="scroll-mt-24 space-y-3">
      <StatRow columns={Math.min(tiles.length, 5)}>{tiles.slice(0, 5)}</StatRow>
      <p className="text-caption text-ink-soft">
        Speaker scores are compared across tournaments. Circuits scale differently, so the tab
        placement above is the stronger measure of level — it compares you only with the people
        who were in the same rooms.
      </p>
    </section>
  );
}

// ── Quirks ────────────────────────────────────────────────────────────────

function Quirks({ stats }: { stats: SpeakerStats }) {
  if (stats.quirks.length === 0) return null;
  return (
    <section id="findings" aria-label="What the numbers say" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Findings"
        title="What the numbers say"
        meta="Each claim is checkable against the tables below"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {stats.quirks.map((q) => (
          <article key={q.id} className="panel p-4">
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={
                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' +
                  (q.tone === 'pos' ? 'bg-pos' : q.tone === 'neg' ? 'bg-neg' : 'bg-ink-soft/50')
                }
              />
              <div className="min-w-0">
                <p className="text-table text-ink">{q.text}</p>
                <p className="mt-1.5 data-label">{q.basis}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ── Score distribution ────────────────────────────────────────────────────

function ScoreDistribution({ stats }: { stats: SpeakerStats }) {
  const p = stats.scoreProfile;
  if (p.speeches === 0) return null;

  return (
    <section id="distribution" aria-label="Score distribution" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Distribution"
        title="Every speech you have been scored on"
        meta={`${p.speeches} speeches`}
      />
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="panel p-4">
          <Histogram
            bins={p.bins}
            highlightIndex={p.meanBinIndex}
            formatBin={(from, to) => (to - from > 1 ? `${from}` : `${from}`)}
          />
          <p className="mt-3 text-caption text-ink-soft">
            Each column is a score band; the highlighted one contains your career average.
          </p>
        </div>

        <div className="panel divide-y divide-border">
          <StatLine label="Median" value={p.median?.toFixed(1)} />
          <StatLine
            label="Middle 50%"
            value={p.q1 != null && p.q3 != null ? `${p.q1.toFixed(1)} – ${p.q3.toFixed(1)}` : null}
            hint={p.iqr != null ? `${p.iqr.toFixed(1)} points wide` : undefined}
          />
          <StatLine
            label="Floor / ceiling"
            value={p.p10 != null && p.p90 != null ? `${p.p10.toFixed(1)} – ${p.p90.toFixed(1)}` : null}
            hint="10th to 90th percentile of your speeches"
          />
          <StatLine
            label="Range"
            value={p.min != null && p.max != null ? `${p.min.toFixed(1)} – ${p.max.toFixed(1)}` : null}
          />
          {p.best ? (
            <StatLine
              label="Best speech"
              value={p.best.score.toFixed(1)}
              hint={`R${p.best.roundNumber} · ${p.best.tournamentName}${p.best.year ? ` ${p.best.year}` : ''}`}
              note={p.best.motion}
            />
          ) : null}
          {p.worst ? (
            <StatLine
              label="Lowest speech"
              value={p.worst.score.toFixed(1)}
              hint={`R${p.worst.roundNumber} · ${p.worst.tournamentName}${p.worst.year ? ` ${p.worst.year}` : ''}`}
              note={p.worst.motion}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StatLine({
  label,
  value,
  hint,
  note,
}: {
  label: string;
  value?: string | null;
  hint?: string;
  note?: string | null;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="data-label">{label}</span>
        <span className="num text-table text-ink">{value ?? <Nil />}</span>
      </div>
      {hint ? <div className="mt-0.5 text-caption text-ink-soft">{hint}</div> : null}
      {note ? (
        <div className="mt-1 line-clamp-2 text-caption italic text-ink-soft" title={note}>
          “{note}”
        </div>
      ) : null}
    </div>
  );
}

// ── Field standing ────────────────────────────────────────────────────────

function FieldStanding({ stats }: { stats: SpeakerStats }) {
  const f = stats.fieldContext;
  const rows = f.placements.filter((p) => p.percentile != null || p.delta != null);
  if (rows.length === 0) return null;

  // Label by YEAR, not tournament name. Eleven truncated names at this
  // width overlapped into an unreadable smear; the name lives in the table
  // directly above, so the axis only has to carry the ordering.
  const trend = [...f.placements]
    .filter((p) => p.percentile != null && p.year != null && !p.incompleteDraw)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
    .map((p) => ({ label: String(p.year), value: p.percentile! }));

  return (
    <section id="field" aria-label="Standing against the field" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Field"
        title="How you placed against the people in the room"
        meta={`${rows.length} tournament${rows.length === 1 ? '' : 's'} with a comparable tab`}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-1">
          <div className="space-y-4">
            {f.meanPercentile != null ? (
              <Meter
                label="Average placement percentile"
                display={`${f.meanPercentile.toFixed(0)}th`}
                value={f.meanPercentile}
                tone="blue"
              />
            ) : null}
            {f.bestPlacement?.percentile != null ? (
              <Meter
                label={`Best — ${f.bestPlacement.tournamentName}`}
                display={`${f.bestPlacement.percentile.toFixed(0)}th`}
                value={f.bestPlacement.percentile}
                tone="gold"
              />
            ) : null}
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              <StatTile
                label="Avg vs field"
                size="sm"
                value={
                  f.meanDelta == null
                    ? '—'
                    : `${f.meanDelta > 0 ? '+' : '−'}${Math.abs(f.meanDelta).toFixed(1)}`
                }
                accent={f.meanDelta == null ? undefined : f.meanDelta > 0 ? 'pos' : 'neg'}
                hint="Points above the field mean"
              />
              <StatTile
                label="Standard deviations"
                size="sm"
                value={f.meanZ == null ? '—' : `${f.meanZ > 0 ? '+' : '−'}${Math.abs(f.meanZ).toFixed(2)}σ`}
                hint="Above the field mean"
              />
            </div>
          </div>
        </div>

        <div className="panel overflow-hidden lg:col-span-2">
          <TableScroll>
            <Table className="min-w-max" label="Your average against the field, tournament by tournament">
              <thead>
                <tr>
                  <Th className="pl-4">Tournament</Th>
                  <Th numeric>Year</Th>
                  <Th numeric>Your avg</Th>
                  <Th numeric>Field avg</Th>
                  <Th numeric>Δ</Th>
                  <Th numeric>z</Th>
                  <Th numeric className="pr-4">Placed</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Tr key={p.tournamentId} className={p.incompleteDraw ? 'text-ink-soft' : undefined}>
                    <Td className="max-w-[14rem] pl-4 font-medium">
                      <span className="block truncate" title={p.tournamentName}>
                        {p.tournamentName}
                      </span>
                      {p.incompleteDraw ? (
                        <span
                          className="text-caption font-normal text-warning"
                          title="You were scored in fewer rounds than the tournament ran. Placement ranks on total score, so a missed round sinks it even though your per-round average is unaffected — this row is excluded from the career figures on the left."
                        >
                          Partial draw — placement not comparable
                        </span>
                      ) : null}
                    </Td>
                    <Td numeric className="text-ink-soft">{p.year ?? <Nil />}</Td>
                    <Td numeric>{p.userAvg != null ? p.userAvg.toFixed(1) : <Nil />}</Td>
                    <Td numeric className="text-ink-soft">
                      {p.fieldMeanAvg != null ? p.fieldMeanAvg.toFixed(1) : <Nil />}
                    </Td>
                    <Td numeric>
                      {p.delta == null ? (
                        <Nil />
                      ) : (
                        <span className={p.delta >= 0 ? 'val-pos' : 'val-neg'}>
                          {p.delta > 0 ? '+' : '−'}
                          {Math.abs(p.delta).toFixed(1)}
                        </span>
                      )}
                    </Td>
                    <Td numeric className="text-ink-soft">
                      {p.z == null ? <Nil /> : `${p.z > 0 ? '+' : '−'}${Math.abs(p.z).toFixed(2)}`}
                    </Td>
                    <Td numeric className="pr-4">
                      {p.placement != null ? (
                        <span title={`Top ${(100 - (p.percentile ?? 0)).toFixed(0)}% of the tab`}>
                          {p.placement}/{p.speakerCount}
                        </span>
                      ) : (
                        <Nil />
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </div>
      </div>

      {trend.length >= 3 ? (
        <div className="panel p-4">
          <div className="data-label mb-2">Placement percentile over time</div>
          <TrendChart
            points={trend}
            color="blue"
            formatValue={(n) => `${Math.round(n)}`}
            // A percentile is bounded; without a fixed domain the axis
            // auto-fitted to −4…104, which are not values it can take.
            domain={[0, 100]}
            baseline={50}
            baselineLabel="median of the field"
          />
        </div>
      ) : null}

      <p className="text-caption text-ink-soft">
        Field averages divide the tab&rsquo;s published score totals by the tournament&rsquo;s prelim
        round count, so they are exact when everyone spoke every round and slightly low when some
        speakers missed rounds.
        {f.incompleteDraws > 0 ? (
          <>
            {' '}
            {f.incompleteDraws} {f.incompleteDraws === 1 ? 'tournament is' : 'tournaments are'}{' '}
            marked as a partial draw and left out of the figures on the left: placement ranks on
            total score, so a round you weren&rsquo;t scored in drops it regardless of how you
            performed in the rounds you did speak.
          </>
        ) : null}
      </p>
    </section>
  );
}

// ── Round dynamics ────────────────────────────────────────────────────────

function RoundDynamicsSection({ stats }: { stats: SpeakerStats }) {
  const d = stats.roundDynamics;
  if (d.profile.length === 0) return null;

  const points = d.profile.map((p) => ({
    label: `R${p.roundNumber}`,
    value: p.avgScore,
    sub: `n=${p.samples}`,
  }));

  return (
    <section id="dynamics" aria-label="Across a tournament" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Round dynamics"
        title="What happens across a tournament"
        meta={`${d.slopeSamples} tournament${d.slopeSamples === 1 ? '' : 's'} long enough to fit a trend`}
      />
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="panel p-4">
          <TrendChart
            points={points}
            baseline={stats.scoreProfile.mean}
            baselineLabel="career average"
          />
        </div>
        <div className="panel divide-y divide-border">
          <StatLine
            label="First three rounds"
            value={d.openingAvg?.toFixed(1)}
            hint="Mean over tournaments with six or more scored rounds"
          />
          <StatLine label="Last three rounds" value={d.closingAvg?.toFixed(1)} />
          <StatLine
            label="Momentum"
            value={
              d.momentum == null
                ? null
                : `${d.momentum > 0 ? '+' : '−'}${Math.abs(d.momentum).toFixed(2)}`
            }
            hint={
              d.momentum == null
                ? undefined
                : d.momentum > 0
                  ? 'You finish above where you start'
                  : 'You start above where you finish'
            }
          />
          <StatLine
            label="Trend per round"
            value={
              d.slopePerRound == null
                ? null
                : `${d.slopePerRound > 0 ? '+' : '−'}${Math.abs(d.slopePerRound).toFixed(2)}`
            }
            hint="Mean least-squares slope of score against round number"
          />
          <StatLine
            label="Swing within an event"
            value={d.withinTournamentStdev?.toFixed(2)}
            hint="Mean standard deviation of your scores inside one tournament"
          />
          {d.bestRoundNumber ? (
            <StatLine
              label="Strongest round"
              value={`R${d.bestRoundNumber.roundNumber}`}
              hint={`${d.bestRoundNumber.avgScore.toFixed(1)} average over ${d.bestRoundNumber.samples} speeches`}
            />
          ) : null}
          {d.worstRoundNumber ? (
            <StatLine
              label="Weakest round"
              value={`R${d.worstRoundNumber.roundNumber}`}
              hint={`${d.worstRoundNumber.avgScore.toFixed(1)} average over ${d.worstRoundNumber.samples} speeches`}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ── Results ───────────────────────────────────────────────────────────────

function ResultsSection({ stats }: { stats: SpeakerStats }) {
  const r = stats.results;
  if (r.decidedRounds === 0 && r.tournamentsSpoken === 0) return null;

  const totalPointRounds = r.pointsDistribution.reduce((s, p) => s + p.rounds, 0);
  const pointBars = r.pointsDistribution.map((p) => ({
    label: `${p.points} ${p.points === 1 ? 'point' : 'points'}`,
    value: p.rounds,
    display: `${p.rounds} · ${Math.round((p.rounds / Math.max(totalPointRounds, 1)) * 100)}%`,
    tone: (p.points >= 3 ? 'pos' : p.points === 0 ? 'neg' : 'default') as
      | 'pos'
      | 'neg'
      | 'default',
  }));

  return (
    <section id="results" aria-label="Results" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Results"
        title="Rounds, runs and conversions"
        meta={`${r.decidedRounds} decided rounds`}
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        {pointBars.length > 0 ? (
          <div className="panel p-4">
            <div className="data-label mb-3">Team points per round</div>
            <BarList items={pointBars} labelWidth="5.5rem" />
            {r.avgPoints != null ? (
              <p className="mt-3 text-caption text-ink-soft">
                Averaging <span className="num text-ink">{r.avgPoints.toFixed(2)}</span> points a
                round over {totalPointRounds} rounds with a recorded result.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="panel divide-y divide-border">
          <StatLine
            label="Longest winning run"
            value={r.longestWinStreak > 0 ? `${r.longestWinStreak} rounds` : null}
            hint="Consecutive decided rounds, oldest tournament first"
          />
          <StatLine
            label="Longest losing run"
            value={r.longestLossStreak > 0 ? `${r.longestLossStreak} rounds` : null}
          />
          <StatLine
            label="Breaks"
            value={`${r.breaks} of ${r.tournamentsSpoken}`}
            hint={r.breakRate != null ? `${Math.round(r.breakRate * 100)}% conversion` : undefined}
          />
          <StatLine
            label="Deepest outround"
            value={r.deepestOutround}
            hint={r.championships > 0 ? `${r.championships} title${r.championships === 1 ? '' : 's'} won` : undefined}
          />
          <StatLine
            label="Finals reached"
            value={r.finals > 0 ? String(r.finals) : null}
          />
        </div>
      </div>
    </section>
  );
}

// ── Splits ────────────────────────────────────────────────────────────────

function Splits({ stats }: { stats: SpeakerStats }) {
  const { splits } = stats;
  // `dimension` is the column header for the split's key; `title` is the
  // section heading above it. Both are needed — the header has to fit a
  // narrow column, the heading is a sentence.
  const blocks: {
    key: string;
    title: string;
    splits: typeof splits.byPosition;
    dimension: string;
    note?: string;
    points?: boolean;
  }[] = [
    {
      key: 'position',
      title: 'By position in the room',
      dimension: 'Seat',
      splits: splits.byPosition,
      note: 'Positions come from the round-results pages. Tournaments ingested before June 2026 carry none until they are re-ingested.',
      points: true,
    },
    {
      key: 'motionType',
      title: 'By motion stem',
      dimension: 'Stem',
      splits: splits.byMotionType,
      note: 'Stems are community tags approved by a moderator, joined to your rounds by round number.',
    },
    {
      key: 'motionTopic',
      title: 'By subject area',
      dimension: 'Topic',
      splits: splits.byMotionTopic,
    },
    {
      key: 'format',
      title: 'By format',
      dimension: 'Format',
      splits: splits.byFormat,
    },
    {
      key: 'region',
      title: 'By circuit region',
      dimension: 'Region',
      splits: splits.byRegion,
    },
    {
      key: 'fieldSize',
      title: 'By size of the field',
      dimension: 'Field',
      splits: splits.byFieldSize,
      note: 'A break at a 24-team local and a break at a 200-team major are different achievements, so they are counted separately.',
    },
    {
      key: 'year',
      title: 'By season',
      dimension: 'Year',
      splits: splits.byYear,
    },
  ].filter((b) => b.splits.length > 0);

  if (blocks.length === 0) return null;

  return (
    <section id="splits" aria-label="Splits" className="scroll-mt-24 space-y-6">
      <SectionHeader
        label="Splits"
        title="Where the wins and losses concentrate"
        meta="Deltas compare each row with your own career baseline"
      />
      {blocks.map((b) => (
        <div key={b.key} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-h4 font-display font-medium text-ink">{b.title}</h3>
          </div>
          <StatsSplitTable
            splits={b.splits}
            dimensionLabel={b.dimension}
            showPoints={b.points}
          />
          {b.note ? <p className="text-caption text-ink-soft">{b.note}</p> : null}
        </div>
      ))}
    </section>
  );
}

// ── Partners ──────────────────────────────────────────────────────────────

function Partners({ stats }: { stats: SpeakerStats }) {
  const partners = stats.partners.filter((p) => p.tournaments > 0);
  if (partners.length === 0) return null;

  return (
    <section id="partners" aria-label="Partners" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Partners"
        title="Who you debated with"
        meta={`${partners.length} partner${partners.length === 1 ? '' : 's'}`}
      />
      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="min-w-max" label="Results by speaking partner">
            <thead>
              <tr>
                <Th className="pl-4">Partner</Th>
                <Th numeric>Tournaments</Th>
                <Th numeric>Breaks</Th>
                <Th numeric>Your avg</Th>
                <Th numeric title="Your average with this partner minus your career average">
                  vs you
                </Th>
                <Th numeric className="pr-4">Round win rate</Th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <Tr key={p.name}>
                  <Td className="pl-4 font-medium">{p.name}</Td>
                  <Td numeric>{p.tournaments}</Td>
                  <Td numeric>{p.breaks}</Td>
                  <Td numeric>{p.avgScore != null ? p.avgScore.toFixed(1) : <Nil />}</Td>
                  <Td numeric>
                    {p.scoreDelta == null ? (
                      <Nil />
                    ) : (
                      <span
                        className={
                          Math.abs(p.scoreDelta) < 0.3
                            ? 'val-flat'
                            : p.scoreDelta > 0
                              ? 'val-pos'
                              : 'val-neg'
                        }
                      >
                        {p.scoreDelta > 0 ? '+' : '−'}
                        {Math.abs(p.scoreDelta).toFixed(1)}
                      </span>
                    )}
                  </Td>
                  <Td numeric className="pr-4">
                    {p.winRate != null ? (
                      <span title={`${p.decidedRounds} decided rounds`}>
                        {Math.round(p.winRate * 100)}%
                      </span>
                    ) : (
                      <Nil />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
      <p className="text-caption text-ink-soft">
        Partner figures are per tournament, not per round — a team is fixed for an event, so a
        single tournament&rsquo;s result can move a partner&rsquo;s row a long way.
      </p>
    </section>
  );
}

// ── Season trends ─────────────────────────────────────────────────────────

function SeasonTrends({
  seasons,
  judging,
}: {
  seasons: SpeakerStats['seasons'];
  judging: SpeakerStats['judgingSeasons'];
}) {
  const avgTrend = seasons
    .filter((p) => p.avgSpeakerScore != null)
    .map((p) => ({
      label: String(p.year),
      value: p.avgSpeakerScore!,
      sub: `${p.tournaments} ${p.tournaments === 1 ? 'event' : 'events'}`,
    }));
  const breakBars = seasons.map((p) => ({
    label: String(p.year),
    value: p.breakRate,
    display: `${p.breaks}/${p.tournaments} · ${Math.round(p.breakRate * 100)}%`,
    tone: 'gold' as const,
  }));

  if (avgTrend.length === 0 && breakBars.length === 0 && judging.length === 0) return null;

  return (
    <section id="seasons" aria-label="Season by season" className="scroll-mt-24 space-y-3">
      <SectionHeader label="Seasons" title="Year by year" />
      <div className="grid gap-3 lg:grid-cols-2">
        {avgTrend.length > 0 ? (
          <div className="panel p-4">
            <div className="data-label mb-2">Speaker average by season</div>
            <TrendChart points={avgTrend} />
          </div>
        ) : null}
        {breakBars.length > 0 ? (
          <div className="panel p-4">
            <div className="data-label mb-3">Break rate by season</div>
            <BarList items={breakBars} labelWidth="3.5rem" />
          </div>
        ) : null}
        {judging.length > 0 ? (
          <div className="panel p-4 lg:col-span-2">
            <div className="data-label mb-3">Judging by season</div>
            <BarList
              items={judging.map((j) => ({
                label: String(j.year),
                value: j.inroundsChaired,
                display: `${j.inroundsChaired} chaired · ${j.tournaments} ${j.tournaments === 1 ? 'event' : 'events'}${j.outroundTournaments > 0 ? ` · ${j.outroundTournaments} with outrounds` : ''}`,
              }))}
              labelWidth="3.5rem"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ── Coverage ──────────────────────────────────────────────────────────────

function Coverage({ coverage }: { coverage: SpeakerStats['coverage'] }) {
  const lines: { label: string; have: number }[] = [
    { label: 'per-round speaker scores', have: coverage.withRoundScores },
    { label: 'per-round results', have: coverage.withRoundResults },
    { label: 'per-round positions', have: coverage.withPositions },
    { label: 'a comparable speaker tab', have: coverage.withFieldContext },
    { label: 'released motions', have: coverage.withMotions },
    { label: 'approved motion tags', have: coverage.withTaggedMotions },
    { label: 'a region tag', have: coverage.withRegion },
  ];

  return (
    <section id="coverage" aria-label="Coverage" className="scroll-mt-24 panel p-4">
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
        <div className="min-w-0">
          <div className="data-label">What these figures are built on</div>
          <p className="mt-1.5 text-caption text-ink-soft">
            Of your {coverage.tournaments} speaking{' '}
            {coverage.tournaments === 1 ? 'tournament' : 'tournaments'},{' '}
            {lines
              .map((l) => `${l.have} ${l.have === 1 ? 'has' : 'have'} ${l.label}`)
              .join(', ')}
            . Sections backed by fewer tournaments are correspondingly thinner — a gap here
            usually means the tab site never published that column, or the tournament was
            ingested before the parser captured it.
          </p>
        </div>
      </div>
    </section>
  );
}
