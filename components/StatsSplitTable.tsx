import { MIN_QUIRK_ROUNDS, type Split } from '@/lib/cv/speakerStats';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import { deltaTone, signed } from '@/components/stats/format';
import { cn } from '@/lib/utils/cn';
import { OUTCOME_COPY, type OutcomeKind } from '@/lib/cv/roundOutcome';

/**
 * One table shape for every split on /cv/stats — seat, format, region,
 * motion type, topic, year, field size.
 *
 * Sharing the layout is the point: once a debater has read one of these,
 * they can read all of them. What the deltas compare with depends on the
 * caller — the engine's splits use the (filtered) overall figure, the round
 * table's use the whole record per format — and `baselineLabel` says which. Sample size sits
 * in its own column rather than in a footnote, because on this page it is
 * the difference between a finding and a coincidence.
 */
export function StatsSplitTable({
  splits,
  dimensionLabel,
  /**
   * Rows below this many rounds render muted and print their sample size in
   * place of a rate — visible, but not evidence. Defaults to the findings
   * engine's own threshold: a table that called 4 rounds enough while the
   * findings above it needed 6 contradicted itself (§9 rules 1 and 3).
   */
  thinBelow = MIN_QUIRK_ROUNDS,
  showPoints = false,
  /** What the "vs you" columns compare with, for their header titles. */
  baselineLabel = 'your overall figure',
  /** Words for the outcome column: "Win rate", or "2nd-or-better rate" in BP (never "win"). */
  outcome = 'win',
}: {
  outcome?: OutcomeKind;
  splits: Split[];
  dimensionLabel: string;
  thinBelow?: number;
  showPoints?: boolean;
  baselineLabel?: string;
}) {
  if (splits.length === 0) return null;

  const pct = (n: number | null) => (n == null ? null : `${Math.round(n * 100)}%`);
  // The first column is pinned while the figures scroll under it, so a phone
  // reader never loses which row a number belongs to (UX-30). It needs its
  // own background, or the scrolled cells show through it.
  const pin = 'sticky left-0 z-1 bg-card';
  const lastScoreCell = showPoints ? undefined : 'pr-4';

  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max" label={`Results split by ${dimensionLabel.toLowerCase()}`}>
          <thead>
            <tr>
              <Th className={cn('pl-4', pin)}>{dimensionLabel}</Th>
              <Th numeric>Rounds</Th>
              <Th numeric title="Prelim rounds where the tab recorded a result">
                Decided
              </Th>
              <Th numeric>{OUTCOME_COPY[outcome].rate}</Th>
              {/* The unit is in the visible header, not only the title: these
                  two columns sit side by side in different units (UX-31). */}
              <Th
                numeric
                title={`${OUTCOME_COPY[outcome].rate} minus ${baselineLabel}, in percentage points`}
              >
                vs you (pp)
              </Th>
              <Th numeric>Speaker avg</Th>
              <Th
                numeric
                title={`Speaker average minus ${baselineLabel}, in speaker points`}
                className={lastScoreCell}
              >
                vs you (pts)
              </Th>
              {/* No points column at all when the block has no points. An
                  empty header cell is an axe failure (empty-table-header), and
                  a column of blanks reads as missing data. */}
              {showPoints ? (
                <Th numeric className="pr-4">
                  Avg pts
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => {
              const thin = s.rounds < thinBelow;
              return (
                <Tr key={s.key} className={cn(thin && 'text-ink-soft')}>
                  <Td className={cn('pl-4 font-medium', pin)}>
                    {s.key}
                    {thin ? (
                      <span className="ml-1.5 whitespace-nowrap text-caption font-normal text-ink-soft">
                        few rounds
                      </span>
                    ) : null}
                  </Td>
                  <Td numeric>{s.rounds}</Td>
                  <Td numeric className="text-ink-soft">
                    {s.decidedRounds}
                  </Td>
                  {thin ? (
                    // A thin row prints its sample size where the rate would
                    // be. A muted "100%" over two rounds still reads as a
                    // headline figure; "n = 2" reads as what it is (§9 rule 1,
                    // the treatment TeammatesSection already gives a thin row).
                    <>
                      <Td numeric>
                        <ThinCell n={s.decidedRounds} decided />
                      </Td>
                      <Td numeric>
                        <ThinCell n={s.decidedRounds} decided />
                      </Td>
                      <Td numeric>{s.avgScore != null ? s.avgScore.toFixed(1) : <Nil />}</Td>
                      <Td numeric className={lastScoreCell}>
                        <ThinCell n={s.rounds} />
                      </Td>
                    </>
                  ) : (
                    <>
                      <Td numeric>{pct(s.winRate) ?? <Nil />}</Td>
                      <Td numeric>
                        <DeltaText
                          value={s.winRateDelta}
                          digits={0}
                          threshold={WIN_RATE_DELTA_THRESHOLD}
                          suffix="pp"
                        />
                      </Td>
                      <Td numeric>{s.avgScore != null ? s.avgScore.toFixed(1) : <Nil />}</Td>
                      <Td numeric className={lastScoreCell}>
                        <DeltaText
                          value={s.scoreDelta}
                          digits={1}
                          threshold={SCORE_DELTA_THRESHOLD}
                        />
                      </Td>
                    </>
                  )}
                  {showPoints ? (
                    <Td numeric className="pr-4">
                      {s.avgPoints != null ? s.avgPoints.toFixed(2) : <Nil />}
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
    </div>
  );
}

/** "n = 2" in place of a rate on a thin row, with the reason spelled out for a screen reader. */
function ThinCell({ n, decided = false }: { n: number; decided?: boolean }) {
  return (
    <span className="text-caption text-ink-soft">
      n = {n}
      <span className="sr-only">{` ${decided ? 'decided ' : ''}rounds, too few to read as a pattern`}</span>
    </span>
  );
}

/**
 * Thresholds below which a delta renders neutral instead of green/red.
 *
 * These are per-UNIT and must stay separate: win-rate deltas are in
 * percentage points (a 5pp swing is noise on twenty rounds) while score
 * deltas are in speaker points (half a point is a real difference). One
 * shared threshold lit the win-rate column up for sub-1pp noise, which is
 * exactly the false confidence the sample-size rule exists to prevent.
 */
const WIN_RATE_DELTA_THRESHOLD = 5;
const SCORE_DELTA_THRESHOLD = 0.3;

/**
 * A delta against the user's own baseline. Coloured only when it clears the
 * threshold for its unit — otherwise the table lights up for noise — and
 * signed by what it rounds to, so a delta that prints as 0 carries no sign.
 */
function DeltaText({
  value,
  digits,
  threshold,
  suffix = '',
}: {
  value: number | null;
  digits: number;
  threshold: number;
  suffix?: string;
}) {
  if (value == null) return <Nil />;
  const meaningful = Math.abs(value) >= threshold;
  return (
    <span
      className={meaningful ? deltaTone(value, digits) : 'val-flat'}
    >{`${signed(value, digits)}${suffix}`}</span>
  );
}
