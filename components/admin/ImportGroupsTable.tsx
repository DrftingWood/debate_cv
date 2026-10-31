import Link from 'next/link';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { InboxRetryButton } from '@/components/admin/InboxRetryButton';
import { InDatabaseCell, type InDatabase } from '@/components/admin/InDatabaseCell';
import { MarkControls } from '@/components/admin/MarkControls';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
import type { MarkCell } from '@/lib/admin/markCell';
import type { TabState } from '@/lib/admin/tabStatus';

/** A failed-import row as the server prepared it: public address, emails, times in words. */
export type ImportRow = {
  key: string;
  section: 'failing' | 'covered';
  name: string;
  tournamentId: string | null;
  /** The public tab address (never a private one); null shows the name as text. */
  tabUrl: string | null;
  tab: TabState;
  error: string;
  attempts: number;
  users: string[];
  moreUsers: number;
  latest: { text: string; iso: string } | null;
  jobIds: string[];
  /** A covered row's stored copy and when it was scraped; null on a failing row. */
  stored: InDatabase;
  /** Mark checked / Undo; null on a covered row, which has nothing to check. */
  mark: MarkCell | null;
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

// Below md the users, error, attempts, time and actions fold into the
// tournament cell, so a phone shows two columns, the status and the card
// (UX-30). The hidden <col>s are hidden with their cells: a fixed-layout
// table assigns cells to columns by position, so a zero-width col left in
// while its cells are display:none puts each cell one column to the left.
const COLUMNS = [
  { className: 'w-28 md:w-32' },
  { className: 'md:w-64' },
  { className: 'hidden md:table-column md:w-64' },
  { className: 'hidden md:table-column md:w-72' },
  { className: 'hidden md:table-column md:w-24' },
  { className: 'hidden md:table-column md:w-28' },
  { className: 'hidden md:table-column md:w-56' },
];

/**
 * The Imports tab's ledger: one row per tournament (host and slug) across
 * users, the affected users named, with Fix (queue the jobs again) and Mark
 * checked on a row that needs the owner, Undo on one already checked, and
 * only the facts on a row the stored copy covers. A server component: the
 * buttons are client components of their own, sharing the page's one
 * CheckActionsProvider.
 */
export function ImportGroupsTable({ rows }: { rows: readonly ImportRow[] }) {
  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="table-fixed md:min-w-max" label="Failed imports">
          <Cols widths={COLUMNS} />
          <thead>
            <tr>
              <Th className="pl-stack">Tab</Th>
              {/* On a phone the column shares the panel with Tab: the name wraps
                  there rather than run off the edge (hence the `!`). */}
              <Th className="max-md:whitespace-normal!">Tournament</Th>
              <Th className="hidden md:table-cell">Users</Th>
              <Th className="hidden md:table-cell">Error</Th>
              <Th numeric className="hidden md:table-cell">
                Attempts
              </Th>
              <Th className="hidden md:table-cell">Last tried</Th>
              <Th className="hidden pr-stack md:table-cell">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ImportRowView key={row.key} row={row} />
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </div>
  );
}

function ImportRowView({ row }: { row: ImportRow }) {
  return (
    <Tr>
      <Td className="pl-stack align-top">
        <TabStatus tab={row.tab} name={row.name} open={false} />
      </Td>
      <Td rowHeader className="align-top wrap-break-word whitespace-normal">
        <Name row={row} />
        <div className="mt-tight space-y-tight md:hidden">
          <Users row={row} />
          <p className="text-ink">{row.error}</p>
          <p className="font-mono text-caption tabular-nums text-ink-soft">
            {plural(row.attempts, 'attempt')}
            {row.latest ? ' · ' : ''}
            {row.latest ? <time dateTime={row.latest.iso}>{row.latest.text}</time> : null}
          </p>
          <Actions row={row} />
        </div>
      </Td>
      <Td className="hidden align-top wrap-break-word whitespace-normal md:table-cell">
        <Users row={row} />
      </Td>
      <Td className="hidden align-top whitespace-normal md:table-cell">{row.error}</Td>
      <Td numeric className="hidden align-top md:table-cell">
        {row.attempts}
      </Td>
      <Td className="hidden align-top font-mono tabular-nums text-ink-soft md:table-cell">
        {row.latest ? <time dateTime={row.latest.iso}>{row.latest.text}</time> : 'Not finished'}
      </Td>
      <Td className="hidden pr-stack align-top whitespace-normal md:table-cell">
        <Actions row={row} />
      </Td>
    </Tr>
  );
}

/** The tournament's admin page when stored, else its public tab address as a link. */
function Name({ row }: { row: ImportRow }) {
  return (
    <>
      {row.tournamentId ? (
        <Link
          href={`/admin/tournaments/${row.tournamentId}`}
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      ) : (
        <TabLink url={row.tabUrl} text={row.name} className="font-mono text-caption" />
      )}
      {row.section === 'covered' ? (
        <div className="mt-hair">
          <InDatabaseCell stored={row.stored} open={false} />
        </div>
      ) : null}
    </>
  );
}

/** Each affected user's email, then "+n more". */
function Users({ row }: { row: ImportRow }) {
  if (row.users.length === 0) return <span className="text-caption text-ink-soft">No users</span>;
  return (
    <ul className="space-y-hair">
      {row.users.map((u) => (
        <li key={u} className="text-caption wrap-break-word">
          {u}
        </li>
      ))}
      {row.moreUsers > 0 ? (
        <li className="text-caption text-ink-soft">+{row.moreUsers} more</li>
      ) : null}
    </ul>
  );
}

/** Fix and Mark checked, Undo, or the reason a covered row has neither. */
function Actions({ row }: { row: ImportRow }) {
  if (row.section === 'covered' || !row.mark) {
    return (
      <span className="text-caption text-ink-soft">
        Nothing to do: the user already has this tournament from the stored copy.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-inline">
      {row.mark.checkedWords ? null : <InboxRetryButton jobIds={row.jobIds} subject={row.name} />}
      <MarkControls cell={row.mark} name={row.name} />
    </div>
  );
}
