import type { Split } from '@/lib/cv/speakerStats';
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
  /** Rows below this many rounds render muted — visible, but not evidence. */
  thinBelow = 4,
  showPoints = false,
}: {
  splits: Split[];
  dimensionLabel: string;
  thinBelow?: number;
  showPoints?: boolean;
}) {
  if (splits.length === 0) return null;

  const pct = (n: number | null) => (n == null ? null : `${Math.round(n * 100)}%`);
  const signed = (n: number | null, digits = 1) =>
    n == null ? null : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max">
          <thead>
            <tr>
              <Th className="pl-4">{dimensionLabel}</Th>
              <Th numeric>Rounds</Th>
              <Th numeric title="Rounds where the tab recorded a win or loss">Decided</Th>
              <Th numeric>Win rate</Th>
              <Th numeric title="Win rate minus your overall win rate, in percentage points">
                vs you
              </Th>
              <Th numeric>Speaker avg</Th>
              <Th numeric title="Speaker average minus your career average">vs you</Th>
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
                    <DeltaText value={s.winRateDelta} format={(n) => `${signed(n, 0)}pp`} />
                  </Td>
                  <Td numeric>{s.avgScore != null ? s.avgScore.toFixed(1) : <Nil />}</Td>
                  <Td numeric>
                    <DeltaText value={s.scoreDelta} format={(n) => signed(n, 1)!} />
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
 * A delta against the user's own baseline. Coloured only when it clears a
 * threshold that a single round could not produce on its own — otherwise
 * the table lights up green and red for noise.
 */
function DeltaText({
  value,
  format,
}: {
  value: number | null;
  format: (n: number) => string;
}) {
  if (value == null) return <Nil />;
  const meaningful = Math.abs(value) >= 0.3;
  return (
    <span className={!meaningful ? 'val-flat' : value > 0 ? 'val-pos' : 'val-neg'}>
      {format(value)}
    </span>
  );
}
