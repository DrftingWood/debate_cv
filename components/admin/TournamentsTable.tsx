import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Cols, Nil, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { RetryPiecesButton } from '@/components/admin/RetryPiecesButton';
import { ScrapedTime } from '@/components/admin/ScrapedTime';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
import { BAND_BADGE } from '@/components/admin/bandBadge';
import type { TournamentListRow } from '@/lib/admin/tournamentList';

/**
 * One page of "Tournaments in the database": twenty rows, lowest score
 * first. A server component: the page is a full navigation per page, so
 * nothing here keeps state, and every row arrives with a public tab URL.
 *
 * The name carries the one status cell under it (✓ Loaded / ? Partly, with
 * the failed pages on hover and "Retry failed" beside a partial one), which
 * stands in for the old "In database" and "Tab" cells: every row here is
 * stored by definition, and the single "Tab ↗" is the public page itself.
 *
 * Fixed column widths, so the figures and times sit at the same x on every
 * page whatever the names are; the table scrolls sideways on a phone rather
 * than squeezing seven columns into it.
 */
export function TournamentsTable({ rows, now }: { rows: TournamentListRow[]; now: Date }) {
  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max table-fixed" label="Tournaments in the database">
          <Cols widths={['20rem', '5rem', '4.5rem', '6rem', '9rem', '8.5rem', '5.5rem']} />
          <thead>
            <tr>
              <Th className="pl-stack">Tournament</Th>
              <Th>Tab</Th>
              <Th numeric>Year</Th>
              <Th>Format</Th>
              <Th>Scraped</Th>
              <Th numeric>Score</Th>
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
        <div className="mt-hair space-y-hair font-normal">
          {/* The name above is already the link to the details: no second "Open". */}
          <TabStatus tab={row.tab} name={row.name} open={false} />
          {row.withheld > 0 ? <Withheld count={row.withheld} /> : null}
          {row.tab.state === 'partial' ? (
            <div className="flex">
              <RetryPiecesButton tournamentId={row.id} tournamentName={row.name} />
            </div>
          ) : null}
        </div>
      </Td>
      <Td className="align-top">
        <TabLink url={row.tabUrl} text="Tab" of={row.name} missing="No tab" />
      </Td>
      <Td numeric className="align-top">
        {row.year ?? <Nil title="No year stored" />}
      </Td>
      <Td className="align-top">{row.format ?? <Nil title="No format stored" />}</Td>
      <Td className="align-top">
        <ScrapedTime date={row.scrapedAt} now={now} />
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
      <Td numeric className="pr-stack align-top">
        {row.onCvs}
      </Td>
    </Tr>
  );
}

/**
 * Pages the tournament keeps back. Words and a dash, in the quiet ink of a
 * note: a withheld page is the tournament's choice, never a failure, so it
 * takes none of the failure marks.
 */
function Withheld({ count }: { count: number }) {
  return (
    <p className="text-caption text-ink-soft">
      <span aria-hidden>{'—'}</span> {count} {count === 1 ? 'page' : 'pages'} withheld
    </p>
  );
}
