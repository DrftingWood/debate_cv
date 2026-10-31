'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { useFirstRows } from '@/components/ui/useFirstRows';
import { RescrapeSuggestedButton } from '@/components/admin/RescrapeSuggestedButton';
import { TabLink } from '@/components/admin/TabLink';
import { BAND_BADGE } from '@/components/admin/bandBadge';
import { InDatabaseCell, type InDatabase } from '@/components/admin/InDatabaseCell';
import type { SuggestedPiece } from '@/lib/admin/accuracyActions';

export type AccuracyBand = 'good' | 'check' | 'rescrape';

/** A row as the server prepared it: ids as strings, times already in words. */
export type AccuracyTableRow = {
  id: string;
  name: string;
  tabUrl: string | null;
  /** The "In database" cell: stored, and when it was scraped. */
  stored: InDatabase;
  score: number;
  band: AccuracyBand;
  failed: string[];
  suggested: SuggestedPiece[];
  usersAffected: number;
  audited: { text: string; iso: string };
};

// Four badges fit the column on one line; the rest are on the tournament's
// own page. Piece links likewise: a hint where to look, not the full list.
const MAX_BADGES = 4;
const MAX_PIECE_LINKS = 4;

/**
 * "Lowest scores": the ledger of the 200 lowest-scoring audits. A client
 * component only for the first-20 fold (`useFirstRows`), like
 * PartlyLoadedTable, whose columns, badges and link styles it shares.
 */
export function AccuracyTable({ rows }: { rows: AccuracyTableRow[] }) {
  const { shown, more } = useFirstRows(rows);
  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max table-fixed" label="Lowest accuracy scores">
          {/* Fixed widths so the figures and times sit at the same x on
              every row, whatever the names and badges are, and the action
              never wraps its label. */}
          <Cols widths={['16rem', '8.5rem', '20rem', '5rem', '8rem', '6rem', '7rem', '14rem']} />
          <thead>
            <tr>
              <Th className="pl-stack">Tournament</Th>
              <Th numeric>Score</Th>
              <Th>Failing</Th>
              <Th>Tab</Th>
              <Th>In database</Th>
              <Th numeric>On CVs</Th>
              <Th>Audited</Th>
              <Th className="pr-stack text-right">
                <span className="sr-only">Action</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <AccuracyRowView key={row.id} row={row} />
            ))}
          </tbody>
        </Table>
      </TableScroll>
      {more}
    </div>
  );
}

function AccuracyRowView({ row }: { row: AccuracyTableRow }) {
  const badge = BAND_BADGE[row.band];
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
      <Td numeric className="align-top">
        <span className="inline-flex items-baseline gap-inline">
          <Badge variant={badge.variant}>{badge.text}</Badge>
          {row.score}
        </span>
      </Td>
      <Td className="align-top whitespace-normal">
        <FailingCell row={row} />
      </Td>
      <Td className="align-top">
        <TabLink url={row.tabUrl} text="Tab" of={row.name} missing="No tab" />
      </Td>
      <Td className="align-top">
        {/* The name already links the tournament's page: no second "Open". */}
        <InDatabaseCell stored={row.stored} open={false} />
      </Td>
      <Td numeric className="align-top">
        {row.usersAffected}
      </Td>
      <Td className="align-top font-mono tabular-nums text-ink-soft">
        <time dateTime={row.audited.iso}>{row.audited.text}</time>
      </Td>
      <Td className="pr-stack text-right align-top">
        <RescrapeSuggestedButton
          tournamentId={row.id}
          tournamentName={row.name}
          suggested={row.suggested}
        />
      </Td>
    </Tr>
  );
}

/**
 * The failing checks as badges, and under them the first suggested pages
 * as links, so a hint can be checked by eye before re-scraping. A piece
 * whose URL could not be made public is left out of the links; it is still
 * in the re-scrape.
 */
function FailingCell({ row }: { row: AccuracyTableRow }) {
  const extra = row.failed.length - MAX_BADGES;
  const linked = row.suggested.filter((p) => p.url);
  const moreLinks = linked.length - MAX_PIECE_LINKS;
  return (
    <div className="space-y-hair">
      {row.failed.length === 0 ? (
        <span className="text-ink-soft">None failing</span>
      ) : (
        <ul
          className="flex flex-wrap gap-hair"
          aria-label={`${row.failed.length} ${row.failed.length === 1 ? 'check' : 'checks'} failing`}
        >
          {row.failed.slice(0, MAX_BADGES).map((label) => (
            <li key={label}>
              <Badge variant="neutral">{label}</Badge>
            </li>
          ))}
          {extra > 0 ? (
            <li>
              <Badge variant="quiet">+{extra}</Badge>
            </li>
          ) : null}
        </ul>
      )}
      {linked.length > 0 ? (
        <ul
          className="flex flex-wrap gap-x-tight text-caption"
          aria-label={`Suggested pages of ${row.name}`}
        >
          {linked.slice(0, MAX_PIECE_LINKS).map((p) => (
            <li key={`${p.kind}:${p.key}`}>
              <TabLink url={p.url} text={p.label} of={row.name} />
            </li>
          ))}
          {moreLinks > 0 ? <li className="text-ink-soft">+{moreLinks}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
