'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check } from '@/components/ui/icons';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { InboxRetryButton } from '@/components/admin/InboxRetryButton';
import { RescrapeSuggestedButton } from '@/components/admin/RescrapeSuggestedButton';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
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
import { PRIORITY_LABEL, type FlagItem, type Priority } from '@/lib/admin/reviewSetTypes';
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

  return (
    <div className="space-y-tight">
      <BulkBar rows={rows} selected={selected} marking={marking} reviewButton={review.button} />
      {review.panel}
      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="max-md:block md:min-w-max md:table-fixed" label="Inbox items">
            <colgroup className="max-md:hidden">
              {COLUMNS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <InboxHead
              count={rows.length}
              allShown={allShown}
              onToggleAll={() =>
                sel.toggle(
                  rows.map((r) => r.key),
                  !allShown,
                )
              }
            />
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
}: {
  rows: readonly InboxRow[];
  selected: ReadonlySet<string>;
  marking: ReturnType<typeof useMarkChecked>;
  reviewButton: ReactNode;
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
      <div className="flex flex-wrap items-center gap-inline">
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
        <span className="font-mono text-caption tabular-nums text-ink-soft">
          {selected.size} selected
        </span>
      </div>
      {bulk.left > 0 ? (
        <p className="text-caption text-ink-soft">
          {plural(bulk.left, 'ticked item')} will not fit in this press; press again after it saves.
        </p>
      ) : null}
      {marking.error ? (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {marking.error}
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
            className="h-6 w-6 accent-primary align-middle"
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

function RowActions({
  row,
  marking,
  onReview,
}: {
  row: InboxRow;
  marking: ReturnType<typeof useMarkChecked>;
  onReview: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-inline">
      <FixButton row={row} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={marking.busy(row.key)}
        aria-disabled={marking.blocked(row.key) || undefined}
        aria-label={`Mark checked: ${row.name}`}
        onClick={() =>
          marking.mark({ id: row.key, items: row.markItems, keys: [row.key], what: row.name })
        }
      >
        Mark checked
      </Button>
      {row.flagItems.length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Review later: ${row.name}`}
          onClick={onReview}
        >
          Review later
        </Button>
      ) : null}
      <RowMenu row={row} />
    </div>
  );
}

/** "Fix", by what the item's fix is: a re-scrape, a retry, or a place to go. */
function FixButton({ row }: { row: InboxRow }) {
  const fix = row.fix;
  if (fix.type === 'rescrape') {
    return (
      <RescrapeSuggestedButton
        tournamentId={fix.tournamentId}
        tournamentName={row.name}
        suggested={fix.pieces}
        asFix
      />
    );
  }
  if (fix.type === 'retry') return <InboxRetryButton jobIds={fix.jobIds} subject={row.name} />;
  return (
    <Link
      href={fix.href}
      aria-label={`Fix: open ${row.name}`}
      className={buttonClasses({ variant: 'outline', size: 'sm' })}
    >
      Fix
    </Link>
  );
}

/**
 * The row menu: "Open tab ↗" (the public page, a new tab) and "Open
 * details" (the admin page of the stored tournament). A native <details>, so
 * it opens from the keyboard and needs no script; its list flows inside the
 * cell rather than floating, because the table's scroll box would clip a
 * floating one. Absent when the row has neither place to go.
 */
function RowMenu({ row }: { row: InboxRow }) {
  if (!row.tabUrl && !row.tournamentId) return null;
  return (
    <details className="text-table">
      <summary
        aria-label={`More actions for ${row.name}`}
        className={`${buttonClasses({ variant: 'ghost', size: 'sm' })} cursor-pointer list-none`}
      >
        More
      </summary>
      <div className="mt-hair flex flex-col items-start gap-hair">
        <TabLink url={row.tabUrl} text="Open tab" of={row.name} className="py-hair" />
        {row.tournamentId ? (
          <Link
            href={`/admin/tournaments/${row.tournamentId}`}
            aria-label={`Open details of ${row.name}`}
            className="py-hair text-ink underline-offset-4 hover:underline"
          >
            Open details
          </Link>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The tournament's name (a link to its admin page when stored, else its
 * public tab address) and the one status cell under it. An item with no
 * tournament behind it (a parser headline) has no status to show.
 */
function NameAndStatus({ row }: { row: InboxRow }) {
  return (
    <>
      {row.tournamentId ? (
        <Link
          href={`/admin/tournaments/${row.tournamentId}`}
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      ) : row.kind === 'import' ? (
        <TabLink
          url={row.tabUrl}
          text={row.name}
          of={row.name}
          className="font-mono text-caption"
        />
      ) : (
        <span className="font-medium text-ink">{row.name}</span>
      )}
      {row.tab.state === 'not_applicable' ? null : (
        <div className="mt-hair">
          <TabStatus tab={row.tab} name={row.name} open={false} />
        </div>
      )}
    </>
  );
}

/** The one-sentence summary, "+n more", and the changed and flagged marks. */
function WhatIsWrong({ row }: { row: InboxRow }) {
  return (
    <>
      <span className="text-ink">{row.summary}</span>
      {row.more > 0 ? <span className="text-ink-soft"> +{row.more} more</span> : null}
      <div className="flex flex-wrap gap-hair empty:hidden">
        {row.changed ? (
          <Badge variant="warning" className="mt-hair whitespace-normal">
            Changed since you checked it
          </Badge>
        ) : null}
        {row.reviewPriority ? (
          <Badge variant="info" className="mt-hair whitespace-normal">
            Flagged · {PRIORITY_LABEL[row.reviewPriority]}
          </Badge>
        ) : null}
      </div>
    </>
  );
}
