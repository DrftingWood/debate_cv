'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowsClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { useAddToReviewSet } from '@/components/admin/AddToReviewSet';
import { InboxRetryButton } from '@/components/admin/InboxRetryButton';
import { InDatabaseCell, type InDatabase } from '@/components/admin/InDatabaseCell';
import { MarkControls } from '@/components/admin/MarkControls';
import { ShortUrlText } from '@/components/admin/ShortUrlText';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
import { useRetryImports } from '@/components/admin/useRetryImports';
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
const noop = () => {};

// Below md the users, error, attempts, time and actions fold into the
// tournament cell, so a phone shows the checkbox, the status and the card
// (UX-30). The hidden <col>s are hidden with their cells: a fixed-layout
// table assigns cells to columns by position, so a zero-width col left in
// while its cells are display:none puts each cell one column to the left.
const COLUMNS = [
  '3rem',
  { className: 'w-28 md:w-32' },
  { className: 'md:w-64' },
  { className: 'hidden md:table-column md:w-64' },
  { className: 'hidden md:table-column md:w-72' },
  { className: 'hidden md:table-column md:w-24' },
  { className: 'hidden md:table-column md:w-28' },
  { className: 'hidden md:table-column md:w-64' },
];

/** A failing, unchecked row can be ticked for "Retry selected": a checked one is expected, a covered one has nothing to retry. */
const tickable = (r: ImportRow) => r.section === 'failing' && !r.mark?.checkedWords;

/**
 * The Imports tab's ledger: one row per tournament (host and slug) across
 * users, the affected users named. A failing row has Fix (queue its jobs
 * again), Mark checked and Review later (flag its jobs for the review set
 * with a priority and a comment), and a checkbox for "Retry selected";
 * "Retry all n" retries every failing job of the view. A checked row has
 * Undo, and a row the stored copy covers has only the facts: nothing to
 * retry, mark or review. Every action runs through the page's one
 * CheckActionsProvider flight, so none overlaps another.
 */
export function ImportGroupsTable({
  rows,
  retryJobIds = [],
}: {
  rows: readonly ImportRow[];
  /** Every job of the view's failing groups, for "Retry all n". */
  retryJobIds?: readonly string[];
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Only rows still on the page count: after a refresh a requeued row leaves
  // the list, and "3 selected" must not keep counting (or sending) it.
  const selected = rows.filter((r) => tickable(r) && ticked.has(r.key));
  const retry = useRetryImports(() => setTicked(new Set()));
  const toggle = (keys: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  return (
    <div className="space-y-tight">
      {rows.some(tickable) ? (
        <RetryBar
          retry={retry}
          selected={selected.flatMap((r) => r.jobIds)}
          selectedCount={selected.length}
          all={retryJobIds}
        />
      ) : null}
      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="table-fixed md:min-w-max" label="Failed imports">
            <Cols widths={COLUMNS} />
            <Head rows={rows} ticked={ticked} onToggle={toggle} />
            <tbody>
              {rows.map((row) => (
                <ImportRowView
                  key={row.key}
                  row={row}
                  checked={ticked.has(row.key)}
                  onToggle={() => toggle([row.key], !ticked.has(row.key))}
                />
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
    </div>
  );
}

function RetryBar({
  retry,
  selected,
  selectedCount,
  all,
}: {
  retry: ReturnType<typeof useRetryImports>;
  selected: readonly string[];
  selectedCount: number;
  all: readonly string[];
}) {
  const errorId = useId();
  const icon = <ArrowsClockwise className="h-4 w-4" aria-hidden />;
  const button = (which: 'selected' | 'all', label: string, ids: readonly string[]) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={retry.busy(which)}
      aria-disabled={retry.blocked(which) || undefined}
      className={retry.blocked(which) ? 'cursor-not-allowed opacity-50' : undefined}
      leftIcon={icon}
      aria-describedby={retry.error ? errorId : undefined}
      onClick={() => retry.run(which, ids)}
    >
      {label}
    </Button>
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-inline">
        {button('selected', 'Retry selected', selected)}
        {all.length > 0
          ? button('all', `Retry all ${all.length.toLocaleString('en-GB')}`, all)
          : null}
        <span className="font-mono text-caption tabular-nums text-ink-soft">
          {selectedCount} selected
        </span>
      </div>
      {/* There from the first render, empty, so its words are announced (UX-19). */}
      <p role="status" aria-live="polite" className="text-caption text-ink-soft empty:hidden">
        {retry.message}
      </p>
      {retry.error ? (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {retry.error}
        </p>
      ) : null}
    </>
  );
}

function Head({
  rows,
  ticked,
  onToggle,
}: {
  rows: readonly ImportRow[];
  ticked: ReadonlySet<string>;
  onToggle: (keys: string[], on: boolean) => void;
}) {
  const shown = rows.filter(tickable);
  const all = shown.length > 0 && shown.every((r) => ticked.has(r.key));
  return (
    <thead>
      <tr>
        <Th className="pl-stack">
          {shown.length > 0 ? (
            <input
              type="checkbox"
              className="h-6 w-6 accent-primary align-middle"
              checked={all}
              onChange={() =>
                onToggle(
                  shown.map((r) => r.key),
                  !all,
                )
              }
              aria-label={`Select the ${plural(shown.length, 'import')} shown`}
            />
          ) : (
            <span className="sr-only">Select</span>
          )}
        </Th>
        <Th>Tab</Th>
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
  );
}

function ImportRowView({
  row,
  checked,
  onToggle,
}: {
  row: ImportRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Tr>
      <Td className="pl-stack align-top">
        {tickable(row) ? (
          <input
            type="checkbox"
            className="h-6 w-6 accent-primary align-middle"
            checked={checked}
            onChange={onToggle}
            // Names its row (UX-11): the address is what the admin reads across to.
            aria-label={`Select ${row.name}`}
          />
        ) : null}
      </Td>
      <Td className="align-top">
        <TabStatus tab={row.tab} name={row.name} open={false} />
      </Td>
      <Td rowHeader className="align-top wrap-break-word whitespace-normal">
        <Name row={row} />
        <div className="mt-tight space-y-tight md:hidden">
          <Users row={row} />
          <ShortUrlText text={row.error} className="block text-ink" />
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
      <Td className="hidden align-top whitespace-normal md:table-cell">
        <ShortUrlText text={row.error} />
      </Td>
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
        <TabLink
          url={row.tabUrl}
          text={row.name}
          className="font-mono text-caption [overflow-wrap:anywhere]"
        />
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

/** Fix, Mark checked and Review later, Undo, or the reason a covered row has none. */
function Actions({ row }: { row: ImportRow }) {
  if (row.section === 'covered' || !row.mark) {
    return (
      <span className="text-caption text-ink-soft">
        Nothing to do: the user already has this tournament from the stored copy.
      </span>
    );
  }
  return <FailingActions row={row} mark={row.mark} />;
}

function FailingActions({ row, mark }: { row: ImportRow; mark: MarkCell }) {
  // The group's jobs are the review items, as the old failed-imports table
  // flagged them: a flag per job, with one priority and comment.
  const review = useAddToReviewSet(
    row.jobIds.map((sourceId) => ({ source: 'import' as const, sourceId })),
    { noun: 'import', onAdded: noop, label: 'Review later' },
  );
  const checked = Boolean(mark.checkedWords);
  return (
    <div className="space-y-tight">
      <div className="flex flex-wrap items-start gap-inline">
        {checked ? null : <InboxRetryButton jobIds={row.jobIds} subject={row.name} />}
        <MarkControls cell={mark} name={row.name} />
        {checked ? null : review.button}
      </div>
      {checked ? null : review.panel}
    </div>
  );
}
