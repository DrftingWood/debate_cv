import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import type { TeamPlacementRow } from '@/lib/cv/speakerStats';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { formatTopPercent } from '@/lib/cv/teamPlacement';
import { useFirstRows } from '@/components/ui/useFirstRows';

/**
 * The Team placement section's per-tournament table: team rank, top
 * percent, break seed and furthest outround. On a phone it keeps tournament
 * and rank only, with the outround under the name (the rest scrolled the
 * rank out of view); the other columns return from `sm`.
 */
export function TeamPlacementTable({ placements }: { placements: TeamPlacementRow[] }) {
  const { shown, more } = useFirstRows(placements);
  return (
    <div className="panel overflow-hidden lg:col-span-2">
      <TableScroll>
        <Table
          className="min-w-max"
          label="Your team's placement and furthest outround, tournament by tournament"
        >
          <thead>
            <tr>
              <Th className="pl-4">Tournament</Th>
              {/* A phone keeps tournament and rank, with the outround under
                      the name; the rest scrolled the rank out of view. */}
              <Th numeric className="hidden sm:table-cell">
                Year
              </Th>
              <Th
                numeric
                className="pr-4 sm:pr-3"
                title="Prelim team-tab rank, of the teams on the tab"
              >
                Team rank
              </Th>
              <Th numeric className="hidden sm:table-cell">
                Top
              </Th>
              <Th
                numeric
                className="hidden sm:table-cell"
                title="Break seed, of the teams on the Open break where known"
              >
                Break
              </Th>
              <Th className="hidden sm:table-cell pr-4">Furthest outround</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <Tr key={p.tournamentId}>
                <Td rowHeader className="max-w-56 pl-4 font-medium">
                  <span className="block wrap-break-word">{p.tournamentName}</span>
                  {p.outround ? (
                    <span className="block text-caption font-normal text-break-gold sm:hidden">
                      {formatStageForDisplay(p.outround)}
                      {p.won ? ' (won)' : ''}
                    </span>
                  ) : null}
                </Td>
                <Td numeric className="hidden sm:table-cell text-ink-soft">
                  {p.year ?? <Nil />}
                </Td>
                <Td numeric className="pr-4 sm:pr-3">
                  {p.teamRank}/{p.totalTeams}
                </Td>
                <Td numeric className="hidden sm:table-cell text-ink-soft">
                  {formatTopPercent(p.topPercent)}
                </Td>
                <Td numeric className="hidden sm:table-cell">
                  {p.breakRank == null ? (
                    <Nil title="No break seed published" />
                  ) : p.breakingTeams != null ? (
                    `${p.breakRank}/${p.breakingTeams}`
                  ) : (
                    `#${p.breakRank}`
                  )}
                </Td>
                <Td className="hidden sm:table-cell whitespace-nowrap pr-4">
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
      {more}
    </div>
  );
}
