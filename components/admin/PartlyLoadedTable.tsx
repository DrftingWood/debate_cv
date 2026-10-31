'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { useFirstRows } from '@/components/ui/useFirstRows';
import { RetryPiecesButton } from '@/components/admin/RetryPiecesButton';
import { TabLink } from '@/components/admin/TabLink';
import { InDatabaseCell, type InDatabase } from '@/components/admin/InDatabaseCell';

/** A row as the server prepared it: ids as strings, times already in words. */
export type PartlyLoadedRow = {
  id: string;
  name: string;
  /** The public tab address (made public by getScrapeHealth); null shows "None". */
  tabUrl: string | null;
  /** The "In database" cell: stored, and when it was scraped. */
  stored: InDatabase;
  missing: string[];
  lastTried: { text: string; iso: string };
  /** Null when at least one piece has used up its automatic retries. */
  nextRetry: { text: string; iso: string } | null;
};

// Six labels fit one line at desktop width; past that the cell wraps into a
// block that pushes every other row down, and the full list is one click
// away on the tournament's own page.
const MAX_BADGES = 6;

/**
 * The "Partly loaded tournaments" ledger. A client component only because
 * the first-20 fold (`useFirstRows`) keeps state; the rows arrive fully
 * formatted from `ScrapeHealthSection`.
 */
export function PartlyLoadedTable({ rows }: { rows: PartlyLoadedRow[] }) {
  const { shown, more } = useFirstRows(rows);
  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max table-fixed" label="Partly loaded tournaments">
          {/* Fixed widths so the time columns sit at the same x whatever the
              tournament names are, and the action column never squeezes the
              button onto two lines. */}
          <Cols widths={['16rem', '5rem', '8rem', '20rem', '7rem', '8rem', '10rem']} />
          <thead>
            <tr>
              <Th className="pl-stack">Tournament</Th>
              <Th>Tab</Th>
              <Th>In database</Th>
              <Th>Missing</Th>
              <Th>Last tried</Th>
              <Th>Next retry</Th>
              <Th className="pr-stack text-right">
                <span className="sr-only">Action</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <PartlyLoadedRowView key={row.id} row={row} />
            ))}
          </tbody>
        </Table>
      </TableScroll>
      {more}
    </div>
  );
}

function PartlyLoadedRowView({ row }: { row: PartlyLoadedRow }) {
  const extra = row.missing.length - MAX_BADGES;
  return (
    <Tr>
      <Td rowHeader className="pl-stack font-medium">
        <Link
          href={`/admin/tournaments/${row.id}`}
          className="wrap-break-word text-ink underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      </Td>
      <Td>
        <TabLink url={row.tabUrl} text="Tab" of={row.name} missing="No tab" />
      </Td>
      <Td>
        {/* The name already links the tournament's page: no second "Open". */}
        <InDatabaseCell stored={row.stored} open={false} />
      </Td>
      <Td>
        <ul
          className="flex flex-wrap gap-hair"
          aria-label={`${row.missing.length} ${row.missing.length === 1 ? 'piece' : 'pieces'} missing`}
        >
          {row.missing.slice(0, MAX_BADGES).map((label, i) => (
            <li key={`${label}-${i}`}>
              <Badge variant="neutral">{label}</Badge>
            </li>
          ))}
          {extra > 0 ? (
            <li>
              <Badge variant="quiet">+{extra}</Badge>
            </li>
          ) : null}
        </ul>
      </Td>
      <Td className="font-mono tabular-nums text-ink-soft">
        <time dateTime={row.lastTried.iso}>{row.lastTried.text}</time>
      </Td>
      <Td className="font-mono tabular-nums">
        {row.nextRetry ? (
          <time dateTime={row.nextRetry.iso}>{row.nextRetry.text}</time>
        ) : (
          <Badge variant="warning">Needs you</Badge>
        )}
      </Td>
      <Td className="pr-stack text-right">
        <RetryPiecesButton tournamentId={row.id} tournamentName={row.name} />
      </Td>
    </Tr>
  );
}
