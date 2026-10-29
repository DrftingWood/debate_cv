/**
 * The /cv/stats sections, as pure presentational components over a computed
 * SpeakerStats. Moved out of the page unchanged so the filterable client view
 * can render them from stats it recomputes in the browser; the server page and
 * the filtered view share one implementation of every section.
 */

import { Info } from '@/components/ui/icons';
import type { SpeakerStats } from '@/lib/cv/speakerStats';
import { TrendChart } from '@/components/ui/TrendChart';
import { BarList, Meter, Histogram } from '@/components/ui/BarList';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import { StatsSplitTable } from '@/components/StatsSplitTable';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { formatTopPercent } from '@/lib/cv/teamPlacement';
import { OUTCOME_COPY } from '@/lib/cv/roundOutcome';
import { deltaTone, signed, signedOrNull } from '@/components/stats/format';

// ── Headline ──────────────────────────────────────────────────────────────

/**
 * `perRoundOnly` is set under a seat filter: the remaining rounds are a slice
 * of each tournament, so tab placement and break rate — facts about whole
 * tournaments — are left out rather than recomputed into something misleading.
 */
export function HeadlineStats({
  stats,
  perRoundOnly = false,
  filtered = false,
}: {
  stats: SpeakerStats;
  perRoundOnly?: boolean;
  /** Any filter active — the figures cover a slice of the career, not all of it. */
  filtered?: boolean;
}) {
  const { scoreProfile, teamContext, results, volume } = stats;
  const tiles: React.ReactNode[] = [];

  if (scoreProfile.mean != null) {
    tiles.push(
      <StatTile
        key="mean"
        label={filtered ? 'Speaker average (filtered)' : 'Career speaker average'}
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
  // How high the user placed is the TEAM's placement on the team tab — team
  // rank against the number of teams — never the speaker tab.
  if (!perRoundOnly && teamContext.meanTopPercent != null) {
    tiles.push(
      <StatTile
        key="pct"
        label="Average team placement"
        value={`Top ${formatTopPercent(teamContext.meanTopPercent)}`}
        hint={`Team tab · ${teamContext.placements.length} tournaments · ${teamContext.teamsFaced.toLocaleString()} teams`}
      />,
    );
  }
  if (results.winRate != null) {
    tiles.push(
      <StatTile
        key="win"
        label={`Round ${OUTCOME_COPY[results.outcome].rate.toLowerCase()}`}
        value={`${Math.round(results.winRate * 100)}%`}
        hint={`${results.wins} of ${results.decidedRounds} decided prelim rounds`}
      />,
    );
  }
  // BP headline: straights — a points total of at least 2 x rounds. Firsts are
  // shown beside it as the separate break indicator; neither is a "win".
  if (!perRoundOnly && results.bp && results.bp.straightsRate != null) {
    tiles.push(
      <StatTile
        key="straights"
        label="BP straights"
        value={`${Math.round(results.bp.straightsRate * 100)}%`}
        hint={`${results.bp.straights} of ${results.bp.tournaments} BP tournaments averaging 2nd or better · ${results.bp.firsts} firsts in ${results.bp.rounds} rounds`}
      />,
    );
  }
  if (!perRoundOnly && results.breakRate != null) {
    tiles.push(
      <StatTile
        key="break"
        label="Break rate"
        value={`${Math.round(results.breakRate * 100)}%`}
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
      {perRoundOnly ? (
        <p className="text-caption text-ink-soft">Seat filter on: per-round figures only.</p>
      ) : null}
    </section>
  );
}

// ── Quirks ────────────────────────────────────────────────────────────────

// ── Score distribution ────────────────────────────────────────────────────

export function ScoreDistribution({ stats }: { stats: SpeakerStats }) {
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
            formatBin={(from) => `${from}`}
            title="Your speaker scores by band"
            unit="scored speeches"
          />
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
            value={
              p.p10 != null && p.p90 != null ? `${p.p10.toFixed(1)} – ${p.p90.toFixed(1)}` : null
            }
            hint="10th to 90th percentile of your speeches"
          />
          <StatLine
            label="Range"
            value={
              p.min != null && p.max != null ? `${p.min.toFixed(1)} – ${p.max.toFixed(1)}` : null
            }
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
        <div className="mt-1 wrap-break-word text-caption italic text-ink-soft">“{note}”</div>
      ) : null}
    </div>
  );
}

// ── Team standing ─────────────────────────────────────────────────────────

/**
 * How high the user placed: the team's prelim rank against the teams on the
 * tab, and how far the team went in the outrounds. The headline "Average team
 * placement" tile and the team-percentile finding are checkable against this
 * table.
 */
export function TeamStanding({ stats }: { stats: SpeakerStats }) {
  const t = stats.teamContext;
  if (t.placements.length === 0) return null;

  const trend = [...t.placements]
    .filter((p) => p.year != null)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
    .map((p) => ({ label: String(p.year), value: p.percentile }));

  return (
    <section id="team-tab" aria-label="Standing on the team tab" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Team tab"
        title="How high your team placed"
        meta={`${t.placements.length} tournament${t.placements.length === 1 ? '' : 's'} with a team rank`}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-1">
          <div className="space-y-4">
            {t.meanPercentile != null && t.meanTopPercent != null ? (
              <Meter
                label="Average team placement"
                display={`Top ${formatTopPercent(t.meanTopPercent)}`}
                value={t.meanPercentile}
                tone="blue"
              />
            ) : null}
            {t.bestPlacement ? (
              <Meter
                label={`Best — ${t.bestPlacement.tournamentName}`}
                display={`Top ${formatTopPercent(t.bestPlacement.topPercent)}`}
                value={t.bestPlacement.percentile}
                tone="gold"
              />
            ) : null}
          </div>
        </div>

        <div className="panel overflow-hidden lg:col-span-2">
          <TableScroll>
            <Table
              className="min-w-max"
              label="Your team's placement and furthest outround, tournament by tournament"
            >
              <thead>
                <tr>
                  <Th className="pl-4">Tournament</Th>
                  <Th numeric>Year</Th>
                  <Th numeric title="Prelim team-tab rank, of the teams on the tab">
                    Team rank
                  </Th>
                  <Th numeric>Top</Th>
                  <Th numeric title="Break seed, of the teams on the Open break where known">
                    Break
                  </Th>
                  <Th className="pr-4">Furthest outround</Th>
                </tr>
              </thead>
              <tbody>
                {t.placements.map((p) => (
                  <Tr key={p.tournamentId}>
                    <Td rowHeader className="max-w-56 pl-4 font-medium">
                      <span className="block wrap-break-word">{p.tournamentName}</span>
                    </Td>
                    <Td numeric className="text-ink-soft">
                      {p.year ?? <Nil />}
                    </Td>
                    <Td numeric>
                      {p.teamRank}/{p.totalTeams}
                    </Td>
                    <Td numeric className="text-ink-soft">
                      {formatTopPercent(p.topPercent)}
                    </Td>
                    <Td numeric>
                      {p.breakRank == null ? (
                        <Nil title="No break seed published" />
                      ) : p.breakingTeams != null ? (
                        `${p.breakRank}/${p.breakingTeams}`
                      ) : (
                        `#${p.breakRank}`
                      )}
                    </Td>
                    <Td className="whitespace-nowrap pr-4">
                      {p.outround ? (
                        <span className="text-break-gold">
                          {formatStageForDisplay(p.outround)}
                          {p.won ? ' (won)' : ''}
                        </span>
                      ) : (
                        <Nil title="Did not reach an outround" />
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
          <div className="data-label mb-2">Team-tab percentile over time</div>
          <TrendChart
            points={trend}
            color="blue"
            formatValue={(n) => `${Math.round(n)}`}
            domain={[0, 100]}
            baseline={50}
            baselineLabel="median team"
            title="Team-tab percentile by year"
            valueLabel="Percentile"
          />
        </div>
      ) : null}
    </section>
  );
}

// ── Field standing ────────────────────────────────────────────────────────

/** A delta's tone as a StatTile accent; a figure that rounds to 0 stays ink. */
const TILE_ACCENT = { 'val-pos': 'pos', 'val-neg': 'neg', 'val-flat': undefined } as const;

export function FieldStanding({ stats }: { stats: SpeakerStats }) {
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
    <section id="field" aria-label="Standing on the speaker tab" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Speaker tab"
        title="How your own scores placed among the speakers"
        meta={`${rows.length} tournament${rows.length === 1 ? '' : 's'} with a comparable speaker tab`}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-1">
          <div className="space-y-4">
            {f.meanPercentile != null ? (
              <Meter
                label="Average speaker-tab percentile"
                display={`${f.meanPercentile.toFixed(0)}th`}
                value={f.meanPercentile}
                tone="blue"
              />
            ) : null}
            {f.bestPlacement?.percentile != null ? (
              <Meter
                label={`Best speaker tab — ${f.bestPlacement.tournamentName}`}
                display={`${f.bestPlacement.percentile.toFixed(0)}th`}
                value={f.bestPlacement.percentile}
                tone="gold"
              />
            ) : null}
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              <StatTile
                label="Avg vs field"
                size="sm"
                value={signedOrNull(f.meanDelta) ?? '—'}
                accent={f.meanDelta == null ? undefined : TILE_ACCENT[deltaTone(f.meanDelta)]}
                hint="Speaker points against the field mean"
              />
              <StatTile
                label="Standard deviations"
                size="sm"
                value={f.meanZ == null ? '—' : `${signed(f.meanZ, 2)}σ`}
                hint="Against the field mean, in standard deviations"
              />
            </div>
          </div>
        </div>

        <div className="panel overflow-hidden lg:col-span-2">
          <TableScroll>
            <Table
              className="min-w-max"
              label="Your speaker average against the speaker tab, tournament by tournament"
            >
              <thead>
                <tr>
                  <Th className="pl-4">Tournament</Th>
                  <Th numeric>Year</Th>
                  <Th numeric>Your avg</Th>
                  <Th numeric>Field avg</Th>
                  <Th numeric title="Your average minus the field average, in speaker points">
                    vs field (pts)
                  </Th>
                  <Th numeric title="The same gap in standard deviations of the field">
                    z-score
                  </Th>
                  <Th
                    numeric
                    className="pr-4"
                    title="Your place among every speaker on the speaker tab"
                  >
                    Spk tab
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Tr
                    key={p.tournamentId}
                    className={p.incompleteDraw ? 'text-ink-soft' : undefined}
                  >
                    <Td rowHeader className="max-w-56 pl-4 font-medium">
                      <span className="block wrap-break-word">{p.tournamentName}</span>
                      {p.incompleteDraw ? (
                        <span
                          className="text-caption font-normal text-warning"
                          title="You were scored in fewer rounds than the tournament ran. Placement ranks on total score, so a missed round sinks it even though your per-round average is unaffected — this row is excluded from the career figures on the left."
                        >
                          Partial draw — placement not comparable
                        </span>
                      ) : null}
                    </Td>
                    <Td numeric className="text-ink-soft">
                      {p.year ?? <Nil />}
                    </Td>
                    <Td numeric>{p.userAvg != null ? p.userAvg.toFixed(1) : <Nil />}</Td>
                    <Td numeric className="text-ink-soft">
                      {p.fieldMeanAvg != null ? p.fieldMeanAvg.toFixed(1) : <Nil />}
                    </Td>
                    <Td numeric>
                      {p.delta == null ? (
                        <Nil />
                      ) : (
                        <span className={deltaTone(p.delta)}>{signed(p.delta)}</span>
                      )}
                    </Td>
                    <Td numeric className="text-ink-soft">
                      {p.z == null ? <Nil /> : signed(p.z, 2)}
                    </Td>
                    <Td numeric className="pr-4">
                      {p.placement != null ? (
                        <span
                          title={`Top ${(100 - (p.percentile ?? 0)).toFixed(0)}% of the speaker tab`}
                        >
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
          <div className="data-label mb-2">Speaker-tab percentile over time</div>
          <TrendChart
            points={trend}
            color="blue"
            formatValue={(n) => `${Math.round(n)}`}
            // A percentile is bounded; without a fixed domain the axis
            // auto-fitted to −4…104, which are not values it can take.
            domain={[0, 100]}
            baseline={50}
            baselineLabel="median speaker"
            title="Speaker-tab percentile by year"
            valueLabel="Percentile"
          />
        </div>
      ) : null}

      <p className="text-caption text-ink-soft">
        Field averages divide the tab&rsquo;s published score totals by the tournament&rsquo;s
        prelim round count, so they are exact when everyone spoke every round and slightly low when
        some speakers missed rounds.
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

export function RoundDynamicsSection({ stats }: { stats: SpeakerStats }) {
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
            baselineLabel="your average"
            title="Speaker average by round number, with the number of speeches behind each"
            valueLabel="Speaker avg"
          />
        </div>
        <div className="panel divide-y divide-border">
          <StatLine
            label="First three rounds"
            value={d.openingAvg?.toFixed(1)}
            hint="Tournaments with 6+ scored rounds"
          />
          <StatLine label="Last three rounds" value={d.closingAvg?.toFixed(1)} />
          <StatLine
            label="Momentum"
            value={signedOrNull(d.momentum, 2)}
            hint={
              d.momentum == null
                ? undefined
                : signed(d.momentum, 2).startsWith('+')
                  ? 'You finish above where you start'
                  : signed(d.momentum, 2).startsWith('−')
                    ? 'You start above where you finish'
                    : 'You finish level with where you start'
            }
          />
          <StatLine
            label="Trend per round"
            value={signedOrNull(d.slopePerRound, 2)}
            hint="Average score change per round"
          />
          <StatLine
            label="Swing within an event"
            value={d.withinTournamentStdev?.toFixed(2)}
            hint="Average spread within a tournament"
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

/**
 * `perRoundOnly` (seat filter) keeps the points distribution, which is per
 * round, and drops runs (consecutive rounds, broken by the removed seats) and
 * breaks / outrounds / finals (whole tournaments).
 */
export function ResultsSection({
  stats,
  perRoundOnly = false,
}: {
  stats: SpeakerStats;
  perRoundOnly?: boolean;
}) {
  const r = stats.results;
  if (r.decidedRounds === 0 && r.tournamentsSpoken === 0) return null;

  const totalPointRounds = r.pointsDistribution.reduce((s, p) => s + p.rounds, 0);
  const pointBars = r.pointsDistribution.map((p) => ({
    label: `${p.points} ${p.points === 1 ? 'point' : 'points'}`,
    value: p.rounds,
    display: `${p.rounds} · ${Math.round((p.rounds / Math.max(totalPointRounds, 1)) * 100)}%`,
    tone: (p.points >= 3 ? 'pos' : p.points === 0 ? 'neg' : 'default') as 'pos' | 'neg' | 'default',
  }));

  return (
    <section id="results" aria-label="Results" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Results"
        title="Rounds, runs and conversions"
        meta={`${r.decidedRounds} decided prelim rounds`}
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

        {perRoundOnly ? (
          <div className="panel p-4 text-caption text-ink-soft">
            Runs, breaks and finals are hidden under a seat filter.
          </div>
        ) : (
          <div className="panel divide-y divide-border">
            <StatLine
              label={OUTCOME_COPY[r.outcome].run}
              value={r.longestWinStreak > 0 ? `${r.longestWinStreak} rounds` : null}
              hint="Consecutive decided prelim rounds, oldest tournament first"
            />
            <StatLine
              label={
                r.outcome === 'win' ? 'Longest losing run' : 'Longest run of 3rd or 4th (or a loss)'
              }
              value={r.longestLossStreak > 0 ? `${r.longestLossStreak} rounds` : null}
            />
            {r.bp ? (
              <>
                <StatLine
                  label="BP straights"
                  value={r.bp.tournaments > 0 ? `${r.bp.straights} of ${r.bp.tournaments}` : null}
                  hint="Tournaments averaging 2nd or better"
                />
                <StatLine
                  label="BP firsts"
                  value={r.bp.rounds > 0 ? `${r.bp.firsts} of ${r.bp.rounds} rounds` : null}
                  hint="Rounds placed 1st"
                />
              </>
            ) : null}
            <StatLine
              label="Breaks"
              value={`${r.breaks} of ${r.tournamentsSpoken}`}
              hint={
                r.breakRate != null ? `${Math.round(r.breakRate * 100)}% conversion` : undefined
              }
            />
            <StatLine
              label="Deepest outround"
              value={r.deepestOutround}
              hint={
                r.championships > 0
                  ? `${r.championships} title${r.championships === 1 ? '' : 's'} won, including ESL / EFL / Novice finals`
                  : undefined
              }
            />
            <StatLine
              label="Finals reached"
              value={r.finals > 0 ? String(r.finals) : null}
              hint="Any bracket, ESL and novice included"
            />
          </div>
        )}
      </div>
    </section>
  );
}

// ── Splits ────────────────────────────────────────────────────────────────

/**
 * `omit` drops blocks another section already covers — on the filterable
 * page, seats per format (PositionsSection) and the classifier's motion types
 * (MotionTypesSection) supersede the mixed-format seat table and the tag-based
 * stem table, which would otherwise print a second, disagreeing answer.
 */
export function Splits({
  stats,
  filtered = false,
  omit = [],
  id = 'splits',
}: {
  stats: SpeakerStats;
  filtered?: boolean;
  omit?: string[];
  /** Statistics shows one dimension per Conditions section, so each needs its own id. */
  id?: string;
}) {
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
  ].filter((b) => b.splits.length > 0 && !omit.includes(b.key));

  if (blocks.length === 0) return null;

  return (
    <section id={id} aria-label="Splits" className="scroll-mt-24 space-y-6">
      <SectionHeader
        label="Splits"
        title={
          stats.results.outcome === 'win'
            ? 'Where the wins and losses concentrate'
            : 'Where good rounds and bad ones concentrate'
        }
        meta={
          filtered
            ? 'Deltas compare each row with your baseline in the filtered rounds'
            : 'Deltas compare each row with your own career baseline'
        }
      />
      {blocks.map((b) => (
        <div key={b.key} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-h4 font-display font-medium text-ink">{b.title}</h3>
          </div>
          <StatsSplitTable
            outcome={stats.results.outcome}
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

// ── Coverage ──────────────────────────────────────────────────────────────

export function Coverage({ coverage }: { coverage: SpeakerStats['coverage'] }) {
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
            {lines.map((l) => `${l.have} ${l.have === 1 ? 'has' : 'have'} ${l.label}`).join(', ')}.
          </p>
        </div>
      </div>
    </section>
  );
}
