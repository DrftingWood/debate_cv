import { MIN_QUIRK_ROUNDS, type Split } from '@/lib/cv/speakerStats';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import { cn } from '@/lib/utils/cn';

/**
 * One table shape for every split on /cv/stats — seat, format, region,
 * motion type, topic, year, field size.
 *
 * Sharing the layout is the point: once a debater has read one of these,
 * they can read all of them, and the deltas are directly comparable because
 * they are all measured against the same career baseline. Sample size sits
 * in its own column rather than in a footnote, because on this page it is
 * the difference between a finding and a coincidence.
 */
export function StatsSplitTable({
  splits,
  dimensionLabel,
  /**
   * Rows below this many rounds render muted — visible, but not evidence.
   *
   * Pinned to the same floor the findings engine uses before it will state
   * a claim. At the old value of 4, a row with four decided rounds and a
   * 100% win rate printed a bold green "+31pp" with no caveat, while the
   * findings section above refused to say anything about the same split
   * because it hadn't cleared six. One page, two standards of evidence, and
   * the louder one was the weaker.
   */
  thinBelow = MIN_QUIRK_ROUNDS,
  showPoints = false,
}: {
  splits: Split[];
  dimensionLabel: string;
  thinBelow?: number;
  showPoints?: boolean;
}) {
  if (splits.length === 0) return null;

  const pct = (n: number | null) => (n == null ? null : `${Math.round(n * 100)}%`);
  /**
   * Sign by what the number ROUNDS to, not by its raw sign. Signing first
   * produced "−0.0" and "+0pp" — a signed zero reads as a real difference
   * the table is too coarse to show, which is the opposite of the truth.
   */
  const signed = (n: number | null, digits = 1) => {
    if (n == null) return null;
    const rounded = Number(n.toFixed(digits));
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${sign}${Math.abs(rounded).toFixed(digits)}`;
  };

  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max" label={`Results split by ${dimensionLabel.toLowerCase()}`}>
          <thead>
            <tr>
              <Th className="pl-4">{dimensionLabel}</Th>
              <Th numeric>Rounds</Th>
              <Th numeric title="Rounds where the tab recorded a win or loss">Decided</Th>
              <Th numeric>Win rate</Th>
              {/*
                Both delta columns used to read "vs you", which left two
                different measurements in different units under one header —
                indistinguishable to a screen reader moving across the row,
                and ambiguous to anyone reading the table cold. The unit is
                the disambiguator and it is already in the cells (+31pp,
                +1.4), so it belongs in the header.
              */}
              <Th numeric title="Win rate minus your overall win rate, in percentage points">
                vs you (pp)
              </Th>
              <Th numeric>Speaker avg</Th>
              <Th numeric title="Speaker average minus your career average">vs you (pts)</Th>
              {showPoints ? <Th numeric className="pr-4">Avg pts</Th> : <Th className="pr-4" />}
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => {
              const thin = s.rounds < thinBelow;
              return (
                <Tr key={s.key} className={cn(thin && 'text-ink-soft')}>
                  <Td className="pl-4 font-medium">
                    {s.key}
                    {thin ? (
                      <span
                        className="ml-1.5 text-caption font-normal text-ink-soft"
                        title={`Only ${s.rounds} rounds — too few to read as a pattern`}
                      >
                        thin
                      </span>
                    ) : null}
                  </Td>
                  <Td numeric>{s.rounds}</Td>
                  <Td numeric className="text-ink-soft">{s.decidedRounds}</Td>
                  <Td numeric>{pct(s.winRate) ?? <Nil />}</Td>
                  <Td numeric>
                    <DeltaText
                      value={s.winRateDelta}
                      threshold={WIN_RATE_DELTA_THRESHOLD}
                      format={(n) => `${signed(n, 0)}pp`}
                    />
                  </Td>
                  <Td numeric>{s.avgScore != null ? s.avgScore.toFixed(1) : <Nil />}</Td>
                  <Td numeric>
                    <DeltaText
                      value={s.scoreDelta}
                      threshold={SCORE_DELTA_THRESHOLD}
                      format={(n) => signed(n, 1)!}
                    />
                  </Td>
                  {showPoints ? (
                    <Td numeric className="pr-4">
                      {s.avgPoints != null ? s.avgPoints.toFixed(2) : <Nil />}
                    </Td>
                  ) : (
                    <Td className="pr-4" />
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
    </div>
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
 * threshold for its unit — otherwise the table lights up for noise.
 */
function DeltaText({
  value,
  threshold,
  format,
}: {
  value: number | null;
  threshold: number;
  format: (n: number) => string;
}) {
  if (value == null) return <Nil />;
  const meaningful = Math.abs(value) >= threshold;
  return (
    <span className={!meaningful ? 'val-flat' : value > 0 ? 'val-pos' : 'val-neg'}>
      {format(value)}
    </span>
  );
}
