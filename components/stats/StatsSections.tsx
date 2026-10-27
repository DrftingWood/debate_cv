/**
 * The /cv/stats sections, as pure presentational components over a computed
 * SpeakerStats. Moved out of the page unchanged so the filterable client view
 * can render them from stats it recomputes in the browser; the server page and
 * the filtered view share one implementation of every section.
 */

import { Info } from 'lucide-react';
import type { SpeakerStats } from '@/lib/cv/speakerStats';
import { TrendChart } from '@/components/ui/TrendChart';
import { BarList, Meter, Histogram } from '@/components/ui/BarList';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import { StatsSplitTable } from '@/components/StatsSplitTable';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { formatTopPercent } from '@/lib/cv/teamPlacement';
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
        accent="blue"
        hint={`Team tab · ${teamContext.placements.length} tournaments · ${teamContext.teamsFaced.toLocaleString()} teams`}
      />,
    );
  }
  if (results.winRate != null) {
    tiles.push(
      <StatTile
        key="win"
        label="Round win rate"
        value={`${Math.round(results.winRate * 100)}%`}
        hint={`${results.wins} of ${results.decidedRounds} decided prelim rounds`}
      />,
    );
  }
  if (!perRoundOnly && results.breakRate != null) {
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
      {perRoundOnly ? (
        <p className="text-caption text-ink-soft">
          Filtered by seat, so only per-round figures are shown. Team placement and break rate
          describe whole tournaments and are left out.
        </p>
      ) : (
        <p className="text-caption text-ink-soft">
          Placement is your team&rsquo;s rank on the team tab against the number of teams, and a
          break is measured by the furthest outround reached. Speaker scores are an individual
          figure: circuits scale them differently, so the speaker-tab section below compares them
          only with the speakers who were in the same rooms.
        </p>
      )}
    </section>
  );
}

// ── Quirks ────────────────────────────────────────────────────────────────

export function Quirks({ stats, visibleIds }: { stats: SpeakerStats; visibleIds?: string[] }) {
  const quirks = visibleIds ? stats.quirks.filter((q) => visibleIds.includes(q.id)) : stats.quirks;
  if (quirks.length === 0) return null;
  return (
    <section id="findings" aria-label="What the numbers say" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Findings"
        title="What the numbers say"
        meta="Each claim is checkable against the tables below"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {quirks.map((q) => (
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
          <p className="mt-3 text-caption text-ink-soft">
            Each column is a one-band slice of your scores, labelled by where the band starts; the
            figure above a column is how many speeches fell in it.
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

export function StatLine({
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
        <div className="mt-1 break-words text-caption italic text-ink-soft">
          “{note}”
        </div>
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
            <p className="border-t border-border pt-3 text-caption text-ink-soft">
              Rank on the prelim team tab against the number of teams. The top 10% of a 40-team
              tab is rank 4 or better.
            </p>
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
                  <Th numeric title="Prelim team-tab rank, of the teams on the tab">Team rank</Th>
                  <Th numeric>Top</Th>
                  <Th numeric title="Break seed, of the teams on the Open break where known">Break</Th>
                  <Th className="pr-4">Furthest outround</Th>
                </tr>
              </thead>
              <tbody>
                {t.placements.map((p) => (
                  <Tr key={p.tournamentId}>
                    <Td rowHeader className="max-w-[14rem] pl-4 font-medium">
                      <span className="block break-words">
                        {p.tournamentName}
                      </span>
                    </Td>
                    <Td numeric className="text-ink-soft">{p.year ?? <Nil />}</Td>
                    <Td numeric>
                      {p.teamRank}/{p.totalTeams}
                    </Td>
                    <Td numeric className="text-ink-soft">{formatTopPercent(p.topPercent)}</Td>
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
            <Table className="min-w-max" label="Your speaker average against the speaker tab, tournament by tournament">
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
                  <Th numeric className="pr-4" title="Your place among every speaker on the speaker tab">
                    Spk tab
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Tr key={p.tournamentId} className={p.incompleteDraw ? 'text-ink-soft' : undefined}>
                    <Td rowHeader className="max-w-[14rem] pl-4 font-medium">
                      <span className="block break-words">
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
                        <span className={deltaTone(p.delta)}>{signed(p.delta)}</span>
                      )}
                    </Td>
                    <Td numeric className="text-ink-soft">
                      {p.z == null ? <Nil /> : signed(p.z, 2)}
                    </Td>
                    <Td numeric className="pr-4">
                      {p.placement != null ? (
                        <span title={`Top ${(100 - (p.percentile ?? 0)).toFixed(0)}% of the speaker tab`}>
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
            hint="Mean over tournaments with six or more scored rounds"
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

/**
 * `perRoundOnly` (seat filter) keeps the points distribution, which is per
 * round, and drops runs (consecutive rounds, broken by the removed seats) and
 * breaks / outrounds / finals (whole tournaments).
 */
export function ResultsSection({ stats, perRoundOnly = false }: { stats: SpeakerStats; perRoundOnly?: boolean }) {
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
            Runs, breaks and finals need whole tournaments in order, so they are not shown while
            filtering by seat.
          </div>
        ) : (
        <div className="panel divide-y divide-border">
          <StatLine
            label="Longest winning run"
            value={r.longestWinStreak > 0 ? `${r.longestWinStreak} rounds` : null}
            hint="Consecutive decided prelim rounds, oldest tournament first"
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
            hint={r.championships > 0 ? `${r.championships} title${r.championships === 1 ? '' : 's'} won, any bracket` : undefined}
          />
          <StatLine
            label="Finals reached"
            value={r.finals > 0 ? String(r.finals) : null}
            hint="Any bracket, ESL and novice included — Outrounds below splits open from the rest"
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
}: {
  stats: SpeakerStats;
  filtered?: boolean;
  omit?: string[];
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
    <section id="splits" aria-label="Splits" className="scroll-mt-24 space-y-6">
      <SectionHeader
        label="Splits"
        title="Where the wins and losses concentrate"
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

// ── Season trends ─────────────────────────────────────────────────────────

export function SeasonTrends({
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
            <TrendChart
              points={avgTrend}
              title="Speaker average by season, with the number of tournaments behind each"
              valueLabel="Speaker avg"
            />
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

// Order matches the render order below. Labels are shorter than the section
// headings on purpose — this is a rail, not a table of contents.
export const STATS_SECTIONS = [
  { id: 'headline', label: 'Headline' },
  { id: 'findings', label: 'Findings' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'team-tab', label: 'Team tab' },
  { id: 'field', label: 'Speaker tab' },
  { id: 'dynamics', label: 'Across a draw' },
  { id: 'round-curve', label: 'Round by round' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'results', label: 'Results' },
  { id: 'funnel', label: 'Outrounds' },
  { id: 'break-margin', label: 'Break margin' },
  { id: 'positions', label: 'Positions' },
  { id: 'motion-types', label: 'Motion types' },
  { id: 'cross-tabs', label: 'Cross-tabs' },
  { id: 'topic-types', label: 'Topic × type' },
  { id: 'splits', label: 'Splits' },
  { id: 'partners', label: 'Teammates' },
  { id: 'carry', label: 'Carry index' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'speaking-judging', label: 'Speaking vs judging' },
  { id: 'judging-lens', label: 'Judging' },
  { id: 'coverage', label: 'Coverage' },
];
