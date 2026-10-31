'use client';

import { useId, useState, type ReactNode } from 'react';
import { Check } from '@/components/ui/icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { NameAndStatus, RowActions, WhatIsWrong } from '@/components/admin/InboxRowParts';
import { useAddToReviewSet } from '@/components/admin/AddToReviewSet';
import { bulkMarkPayload, flagItemsOf } from '@/lib/admin/inboxActions';
import { useMarkChecked } from '@/components/admin/useMarkChecked';
import {
  KIND_LABEL,
  type FixAction,
  type InboxItem,
  type InboxKind,
  type InboxMarkItem,
} from '@/lib/admin/inboxTypes';
import type { FlagItem, Priority } from '@/lib/admin/reviewSetTypes';
import type { TabState } from '@/lib/admin/tabStatus';

/**
 * One Inbox item as the server prepared it for this table: the tournament's
 * address already public, the age already in words, and nothing else. This
 * is serialised into the page, so it carries no private URL key (the server
 * side, toInboxRows, builds it from publicPieceUrl).
 */
export type InboxRow = {
  key: string;
  kind: InboxKind;
  /** The tournament, or what the item is about when it names none (a parser headline). */
  name: string;
  tournamentId: string | null;
  /** The tab's public address; null when there is none. */
  tabUrl: string | null;
  tab: TabState;
  summary: string;
  more: number;
  users: number;
  severity: InboxItem['severity'];
  age: { text: string; iso: string };
  fix: FixAction;
  markItems: InboxMarkItem[];
  flagItems: FlagItem[];
  reviewPriority: Priority | null;
  changed: boolean;
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

// The seven columns from md; below it the table is a stack of cards and the
// column group goes with it (a fixed-layout table assigns cells to columns by
// position, so a col left behind while its cells stack would shift every
// width). Every cell shows on a phone, so no column is hidden on its own.
const COLUMNS = ['3rem', '6.5rem', '16rem', '18rem', '4.5rem', '7rem', '14rem'];

/** The ticked rows, and the ways to change them. */
function useTicked(rows: readonly InboxRow[]) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Only rows still on the page count: after a refresh a marked row is gone,
  // and "3 selected" must not keep counting (or sending) it.
  const selected = new Set(rows.filter((r) => ticked.has(r.key)).map((r) => r.key));
  return {
    selected,
    clear: (keys: readonly string[]) =>
      setTicked((prev) => new Set([...prev].filter((k) => !keys.includes(k)))),
    only: (key: string) => setTicked(new Set([key])),
    none: () => setTicked(new Set()),
    toggle: (keys: string[], on: boolean) =>
      setTicked((prev) => {
        const next = new Set(prev);
        for (const k of keys) {
          if (on) next.add(k);
          else next.delete(k);
        }
        return next;
      }),
  };
}

export function InboxTable({ rows }: { rows: InboxRow[] }) {
  const sel = useTicked(rows);
  const { selected } = sel;
  const marking = useMarkChecked(sel.clear);
  const review = useAddToReviewSet(flagItemsOf(rows, selected), {
    noun: 'item',
    onAdded: sel.none,
    label: selected.size > 0 ? `Review ${selected.size} later` : 'Review later',
  });
  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const toggleAll = () =>
    sel.toggle(
      rows.map((r) => r.key),
      !allShown,
    );

  return (
    <div className="space-y-tight">
      <BulkBar
        rows={rows}
        selected={selected}
        marking={marking}
        reviewButton={review.button}
        allShown={allShown}
        onToggleAll={toggleAll}
      />
      {review.panel}
      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="max-md:block md:min-w-max md:table-fixed" label="Inbox items">
            <colgroup className="max-md:hidden">
              {COLUMNS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <InboxHead count={rows.length} allShown={allShown} onToggleAll={toggleAll} />
            <tbody className="max-md:block">
              {rows.map((row) => (
                <InboxRowView
                  key={row.key}
                  row={row}
                  checked={selected.has(row.key)}
                  onToggle={() => sel.toggle([row.key], !selected.has(row.key))}
                  marking={marking}
                  onReview={() => {
                    sel.only(row.key);
                    review.open();
                  }}
                />
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
    </div>
  );
}

/**
 * "Mark n checked" and "Review n later" for the ticked rows, with the
 * selection count and any refusal. Validated on press, not by disabling the
 * button (UX-16): a disabled button cannot say why it will not work.
 */
function BulkBar({
  rows,
  selected,
  marking,
  reviewButton,
  allShown,
  onToggleAll,
}: {
  rows: readonly InboxRow[];
  selected: ReadonlySet<string>;
  marking: ReturnType<typeof useMarkChecked>;
  reviewButton: ReactNode;
  allShown: boolean;
  onToggleAll: () => void;
}) {
  const errorId = useId();
  const bulk = bulkMarkPayload(rows, selected);
  const press = () => {
    if (selected.size === 0) return marking.setError('Tick at least one item to mark.');
    marking.mark({
      id: 'bulk',
      items: bulk.items,
      keys: bulk.keys,
      what: plural(bulk.keys.length, 'item'),
    });
  };
  return (
    <>
      <div
        role="group"
        aria-label="Bulk actions"
        className="flex flex-wrap items-center gap-inline"
      >
        <SelectAllOnPhone count={rows.length} checked={allShown} onChange={onToggleAll} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={marking.busy('bulk')}
          aria-disabled={marking.blocked('bulk') || undefined}
          aria-describedby={marking.error ? errorId : undefined}
          leftIcon={<Check className="h-4 w-4" aria-hidden />}
          onClick={press}
        >
          {selected.size > 0 ? `Mark ${selected.size} checked` : 'Mark checked'}
        </Button>
        {reviewButton}
        <span aria-live="polite" className="font-mono text-caption tabular-nums text-ink-soft">
          {`${selected.size} selected`}
        </span>
      </div>
      <BulkNotes
        left={bulk.left}
        undoing={marking.undoing}
        error={marking.error}
        errorId={errorId}
      />
    </>
  );
}

/** The table's header box is hidden below md; a phone selects all here. */
function SelectAllOnPhone({
  count,
  checked,
  onChange,
}: {
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="inline-flex min-h-6 items-center gap-inline text-caption text-ink md:hidden">
      <input
        type="checkbox"
        className="h-6 w-6 accent-primary"
        checked={checked}
        onChange={onChange}
      />
      {`Select all ${count} shown`}
    </label>
  );
}

/** Status lines under the bar: an Undo in progress, ticked items left over, a refusal. */
function BulkNotes({
  left,
  undoing,
  error,
  errorId,
}: {
  left: number;
  undoing: string;
  error: string | null;
  errorId: string;
}) {
  return (
    <>
      <p role="status" className="text-caption text-ink-soft empty:hidden">
        {undoing}
      </p>
      {left > 0 ? (
        <p className="text-caption text-ink-soft">
          {plural(left, 'ticked item')} will not fit in this press; press again after it saves.
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

function InboxHead({
  count,
  allShown,
  onToggleAll,
}: {
  count: number;
  allShown: boolean;
  onToggleAll: () => void;
}) {
  return (
    <thead className="max-md:sr-only">
      <tr>
        <Th className="pl-stack">
          <input
            type="checkbox"
            className="h-6 w-6 accent-primary align-middle max-md:hidden"
            checked={allShown}
            onChange={onToggleAll}
            aria-label={`Select the ${plural(count, 'item')} shown`}
          />
        </Th>
        <Th>Kind</Th>
        <Th>Tournament</Th>
        <Th>What is wrong</Th>
        <Th numeric>Users</Th>
        <Th>Age</Th>
        <Th className="pr-stack">Actions</Th>
      </tr>
    </thead>
  );
}

// Phone card cells: a stack beside the checkbox. The figures that have a
// column header (Users, Age) take it as a label drawn from data-label, so
// the DOM keeps one copy of the words.
const CARD_CELL = 'max-md:col-start-2 max-md:border-b-0 max-md:py-hair max-md:text-left';
const CARD_LABEL =
  'max-md:before:mr-inline max-md:before:font-mono max-md:before:text-caption max-md:before:uppercase max-md:before:text-ink-soft max-md:before:content-[attr(data-label)]';

function InboxRowView({
  row,
  checked,
  onToggle,
  marking,
  onReview,
}: {
  row: InboxRow;
  checked: boolean;
  onToggle: () => void;
  marking: ReturnType<typeof useMarkChecked>;
  onReview: () => void;
}) {
  return (
    <Tr className="max-md:grid max-md:grid-cols-[3rem_minmax(0,1fr)] max-md:border-b max-md:border-border/30 max-md:py-tight">
      <Td className="pl-stack align-top max-md:row-span-6 max-md:border-b-0 max-md:pl-stack">
        <input
          type="checkbox"
          className="h-6 w-6 accent-primary align-middle"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${row.name}`}
        />
      </Td>
      <Td className={`align-top ${CARD_CELL}`}>
        <Badge variant={row.severity === 'fail' ? 'danger' : 'warning'}>
          {KIND_LABEL[row.kind]}
        </Badge>
      </Td>
      <Td rowHeader className={`align-top wrap-break-word whitespace-normal ${CARD_CELL}`}>
        <NameAndStatus row={row} />
      </Td>
      <Td className={`align-top whitespace-normal ${CARD_CELL}`}>
        <WhatIsWrong row={row} />
      </Td>
      <Td numeric data-label="Users" className={`align-top ${CARD_CELL} ${CARD_LABEL}`}>
        {row.users}
      </Td>
      <Td
        data-label="Age"
        className={`align-top font-mono tabular-nums text-ink-soft ${CARD_CELL} ${CARD_LABEL}`}
      >
        <time dateTime={row.age.iso}>{row.age.text}</time>
      </Td>
      <Td className={`pr-stack align-top whitespace-normal ${CARD_CELL}`}>
        <RowActions row={row} marking={marking} onReview={onReview} />
      </Td>
    </Tr>
  );
}
