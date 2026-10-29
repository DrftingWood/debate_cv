import { CaretDown } from '@/components/ui/icons';
import type { CvSpeakerRow as SpeakingTableRow, CvTaggedMotion } from '@/lib/cv/buildCvData';
import { TableScroll, Table, Th, Td, Nil } from '@/components/ui/DataTable';
import {
  bpPlacement,
  cumulativePoints,
  isFourTeamRound,
  ledgerMotions,
  ledgerRoundNames,
} from '@/lib/cv/roundLedger';
import { cn } from '@/lib/utils/cn';

/**
 * The per-round ledger behind a tournament row: one line per round with the
 * side debated, the motion released for it, the speaker score and the team
 * result. This is the detail the product scrapes and, until this rebuild,
 * never showed — a speaker score without its motion and side is a number
 * with no story attached.
 *
 * Two shapes. On the desktop ledger (`bare`) it is only the table: the
 * caret that opens it sits at the start of the tournament's own row
 * (RoundsToggle; owner, 2026-10-29: the full-width "Round ledger" line under
 * every row was an extra widget). On a phone card it stays a native
 * <details>, labelled "Rounds", so it works without client JS. Both print
 * expanded.
 */
export function RoundLedger({
  r,
  motionsByTournament,
  bare = false,
  className,
}: {
  r: SpeakingTableRow;
  motionsByTournament: Map<string, CvTaggedMotion[]>;
  bare?: boolean;
  className?: string;
}) {
  const scoreByRound = new Map(r.roundScores.map((s) => [s.roundNumber, s]));
  const resultByRound = new Map(r.teamRoundResults.map((t) => [t.roundNumber, t]));
  const roundNumbers = [...new Set([...scoreByRound.keys(), ...resultByRound.keys()])].sort(
    (a, b) => a - b,
  );
  if (roundNumbers.length === 0) return null;

  // "Round 7" / "Quarterfinals", not "R7"; points as a running total; and a
  // four-team (BP) room shows a placement, since nobody "wins" it outright.
  const roundNames = ledgerRoundNames({
    roundNumbers,
    prelimRoundCount: r.prelimRoundCount,
    eliminationReached: r.eliminationReached,
  });
  const motionsByRound = ledgerMotions({
    roundNumbers,
    roundNames,
    prelimRoundCount: r.prelimRoundCount,
    eliminationReached: r.eliminationReached,
    multiCategoryRun: (r.eliminationReachedByCategory?.length ?? 0) > 1,
    motions: motionsByTournament.get(r.tournamentId.toString()) ?? [],
  });
  const anyMotion = roundNumbers.some((n) => (motionsByRound.get(n) ?? []).length > 0);
  const totalPoints = cumulativePoints(r.teamRoundResults);

  const table = (
    <div className={cn('panel-inset p-3', bare ? 'my-tight' : 'mb-3')}>
      <TableScroll>
        <Table className="text-caption" label={`Round-by-round ledger for ${r.tournamentName}`}>
          <thead>
            <tr>
              <Th>Round</Th>
              <Th>Side</Th>
              {anyMotion ? <Th>Motion</Th> : null}
              <Th numeric>Score</Th>
              <Th numeric title="Team points after this round (running total)">
                Pts
              </Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {roundNumbers.map((n) => {
              const score = scoreByRound.get(n);
              const result = resultByRound.get(n);
              const motions = motionsByRound.get(n) ?? [];
              const placement = isFourTeamRound({
                position: result?.position ?? null,
                format: r.format,
              })
                ? bpPlacement(result?.points ?? null)
                : null;
              return (
                <tr key={n}>
                  <Td className="whitespace-nowrap">{roundNames.get(n) ?? `Round ${n}`}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{result?.position ?? <Nil />}</Td>
                  {anyMotion ? (
                    <Td className="text-ink-soft">
                      {motions.length === 0 ? (
                        <Nil title="No motion released for this round" />
                      ) : (
                        // Every motion on its own line. A round with two
                        // motions used to show the first and park the rest
                        // in a hover-only title, which touch never shows
                        // (CV-9). The width cap sits on the inner block
                        // because browsers ignore max-width on a table cell.
                        <span className="block max-w-lg space-y-1">
                          {motions.map((m, i) => (
                            <span key={i} className="block">
                              {m.text}
                            </span>
                          ))}
                        </span>
                      )}
                    </Td>
                  ) : null}
                  <Td numeric>{score?.score != null ? score.score.toFixed(1) : <Nil />}</Td>
                  <Td numeric>{totalPoints.has(n) ? totalPoints.get(n) : <Nil />}</Td>
                  <Td className="whitespace-nowrap">
                    {isFourTeamRound({ position: result?.position ?? null, format: r.format }) ? (
                      // A BP room has four teams and no winner: show where the
                      // team placed. Colour only the ends, as elsewhere —
                      // colour on a number means up or down.
                      placement ? (
                        <span
                          className={
                            placement === '1st'
                              ? 'val-pos font-medium'
                              : placement === '4th'
                                ? 'val-neg'
                                : undefined
                          }
                        >
                          {placement}
                        </span>
                      ) : (
                        <Nil />
                      )
                    ) : result?.won == null ? (
                      <Nil />
                    ) : result.won ? (
                      <span className="val-pos font-medium">Won</span>
                    ) : (
                      <span className="val-neg">Lost</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
    </div>
  );
  if (bare) return table;
  return (
    <details className={cn('group', className)}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 py-2 text-caption text-ink-soft hover:text-ink coarse:min-h-[44px]">
        <CaretDown
          className="h-3.5 w-3.5 text-primary transition-transform duration-180 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
        Rounds ({roundNumbers.length}){anyMotion ? ', with motions' : ''}
      </summary>
      {table}
    </details>
  );
}

/** How many rounds a row's detail would list: the rounds with a score or a result. */
export function roundCount(r: SpeakingTableRow): number {
  return new Set([
    ...r.roundScores.map((s) => s.roundNumber),
    ...r.teamRoundResults.map((t) => t.roundNumber),
  ]).size;
}
