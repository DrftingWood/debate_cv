import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Cols, Nil, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { TabLink } from '@/components/admin/TabLink';
import { BAND_BADGE } from '@/components/admin/bandBadge';
import type { TournamentListRow } from '@/lib/admin/tournamentList';
import { relativeTime } from '@/lib/utils/relativeTime';

/**
 * One page of "Tournaments in the database": twenty rows, newest scrape
 * first. A server component: the page is a full navigation per page, so
 * nothing here keeps state, and every row arrives with a public tab URL.
 *
 * Fixed column widths, so the figures and times sit at the same x on every
 * page whatever the names are; the table scrolls sideways on a phone rather
 * than squeezing eight columns into it.
 */
export function TournamentsTable({ rows, now }: { rows: TournamentListRow[]; now: Date }) {
  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max table-fixed" label="Tournaments in the database">
          <Cols widths={['18rem', '5rem', '4.5rem', '6rem', '9rem', '8.5rem', '8rem', '5.5rem']} />
          <thead>
            <tr>
              <Th className="pl-stack">Tournament</Th>
              <Th>Tab</Th>
              <Th numeric>Year</Th>
              <Th>Format</Th>
              <Th>Scraped</Th>
              <Th numeric>Score</Th>
              <Th>Partly loaded</Th>
              <Th numeric className="pr-stack">
                On CVs
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TournamentRow key={row.id} row={row} now={now} />
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </div>
  );
}

function TournamentRow({ row, now }: { row: TournamentListRow; now: Date }) {
  return (
    <Tr>
      <Td rowHeader className="pl-stack align-top font-medium">
        <Link
          href={`/admin/tournaments/${row.id}`}
          className="wrap-break-word text-ink underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      </Td>
      <Td className="align-top">
        <TabLink url={row.tabUrl} text="Tab" of={row.name} missing="None" />
      </Td>
      <Td numeric className="align-top">
        {row.year ?? <Nil title="No year stored" />}
      </Td>
      <Td className="align-top">{row.format ?? <Nil title="No format stored" />}</Td>
      <Td className="align-top">
        <time
          dateTime={row.scrapedAt.toISOString()}
          className="block font-mono tabular-nums text-ink-soft"
        >
          {relativeTime(row.scrapedAt, now)}
        </time>
        {row.parserCurrent ? null : <Badge variant="warning">Old parser</Badge>}
      </Td>
      <Td numeric className="align-top">
        {row.score != null && row.band ? (
          <span className="inline-flex items-baseline gap-inline">
            <Badge variant={BAND_BADGE[row.band].variant}>{BAND_BADGE[row.band].text}</Badge>
            {row.score}
          </span>
        ) : (
          <Nil title="Not audited yet" />
        )}
      </Td>
      <Td className="align-top">
        {row.partlyLoaded ? (
          <Badge variant="warning">Partly loaded</Badge>
        ) : (
          <Nil title="Every page loaded" />
        )}
      </Td>
      <Td numeric className="pr-stack align-top">
        {row.onCvs}
      </Td>
    </Tr>
  );
}
