'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
import { useAddToReviewSet } from '@/components/admin/AddToReviewSet';
import type { TabState } from '@/lib/admin/tabStatus';

/** A warning group as the server prepared it: scrubbed text, public tab addresses, time in words. */
export type WarningRow = {
  /** `<parser>|<headline>`: the review set's sourceId. */
  key: string;
  parserName: string;
  headline: string;
  count: number;
  latest: { text: string; iso: string };
  sample: string;
  tournaments: Array<{ id: string | null; name: string; tabUrl: string | null; tab: TabState }>;
  moreTournaments: number;
};

/**
 * "Recent parser warnings" as a ledger (Task 5d): one page of warning
 * groups, busiest first, each with the tournaments whose pages raised it
 * (Tab status, a public "Tab ↗"). Ticked groups go to the review set with a
 * priority and a comment, named by `<parser>|<headline>`.
 */
export function ParserWarningsTable({ rows }: { rows: readonly WarningRow[] }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const selected = rows.filter((r) => ticked.has(r.key)).map((r) => r.key);
  const review = useAddToReviewSet(
    selected.map((sourceId) => ({ source: 'parser_warning' as const, sourceId })),
    { noun: 'warning', onAdded: () => setTicked(new Set()) },
  );
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
      <div className="flex flex-wrap items-center gap-inline">
        {review.button}
        <span className="font-mono text-caption tabular-nums text-ink-soft">
          {selected.length} selected
        </span>
      </div>
      {review.panel}
      <div className="panel overflow-hidden">
        <TableScroll>
          <WarningsTable rows={rows} ticked={ticked} onToggle={toggle} />
        </TableScroll>
      </div>
    </div>
  );
}

// Below md the parser, count, time and tournaments fold into the Warning
// cell, so a phone shows the checkbox and a card per warning (UX-30). The
// hidden <col>s are hidden with their cells (see FailedJobsTable).
const WARNING_COLUMNS = [
  '3rem',
  { className: 'hidden md:table-column md:w-32' },
  { className: 'md:w-96' },
  { className: 'hidden md:table-column md:w-20' },
  { className: 'hidden md:table-column md:w-24' },
  { className: 'hidden md:table-column md:w-72' },
];

function WarningsTable({
  rows,
  ticked,
  onToggle,
}: {
  rows: readonly WarningRow[];
  ticked: ReadonlySet<string>;
  onToggle: (keys: string[], on: boolean) => void;
}) {
  const all = rows.length > 0 && rows.every((r) => ticked.has(r.key));
  const n = rows.length;
  return (
    <Table className="table-fixed md:min-w-max" label="Recent parser warnings">
      <Cols widths={WARNING_COLUMNS} />
      <thead>
        <tr>
          <Th className="pl-stack">
            <input
              type="checkbox"
              className="h-6 w-6 accent-primary align-middle"
              checked={all}
              onChange={() =>
                onToggle(
                  rows.map((r) => r.key),
                  !all,
                )
              }
              aria-label={`Select the ${n} ${n === 1 ? 'warning' : 'warnings'} on this page`}
            />
          </Th>
          <Th className="hidden md:table-cell">Parser</Th>
          <Th className="max-md:whitespace-normal!">Warning</Th>
          <Th numeric className="hidden md:table-cell">
            Count
          </Th>
          <Th className="hidden md:table-cell">Latest</Th>
          <Th className="hidden pr-stack md:table-cell">Tournaments</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <WarningRowView
            key={row.key}
            row={row}
            checked={ticked.has(row.key)}
            onToggle={() => onToggle([row.key], !ticked.has(row.key))}
          />
        ))}
      </tbody>
    </Table>
  );
}

function WarningRowView({
  row,
  checked,
  onToggle,
}: {
  row: WarningRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Tr>
      <Td className="pl-stack align-top">
        <input
          type="checkbox"
          className="h-6 w-6 accent-primary align-middle"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select the ${row.parserName} warning: ${row.headline}`}
        />
      </Td>
      <Td className="hidden align-top font-mono text-caption wrap-break-word whitespace-normal md:table-cell">
        {row.parserName}
      </Td>
      <Td rowHeader className="align-top whitespace-normal wrap-break-word">
        <span className="text-ink">{row.headline}</span>
        {row.sample !== row.headline ? (
          <span className="mt-hair block text-caption text-ink-soft">{row.sample}</span>
        ) : null}
        <div className="mt-tight space-y-tight md:hidden">
          <p className="font-mono text-caption tabular-nums text-ink-soft">
            {row.parserName} · ×{row.count} ·{' '}
            <time dateTime={row.latest.iso}>{row.latest.text}</time>
          </p>
          <Tournaments row={row} />
        </div>
      </Td>
      <Td numeric className="hidden align-top md:table-cell">
        {row.count}
      </Td>
      <Td className="hidden align-top font-mono tabular-nums text-ink-soft md:table-cell">
        <time dateTime={row.latest.iso}>{row.latest.text}</time>
      </Td>
      <Td className="hidden pr-stack align-top whitespace-normal md:table-cell">
        <Tournaments row={row} />
      </Td>
    </Tr>
  );
}

/** Up to five tournaments, each with its Tab status and "Tab ↗", then "+n more". */
function Tournaments({ row }: { row: WarningRow }) {
  if (row.tournaments.length === 0) {
    return <span className="text-caption text-ink-soft">No tab site recorded</span>;
  }
  return (
    <ul className="space-y-tight">
      {row.tournaments.map((t) => (
        <li key={t.id ?? t.name} className="space-y-hair wrap-break-word">
          {t.id ? (
            <Link
              href={`/admin/tournaments/${t.id}`}
              className="text-ink underline underline-offset-4 hover:text-primary"
            >
              {t.name}
            </Link>
          ) : (
            <span className="font-mono text-caption text-ink-soft">{t.name}</span>
          )}
          <div className="flex flex-wrap items-baseline gap-x-tight gap-y-hair text-caption">
            <TabStatus tab={t.tab} name={t.name} open={false} />
            <TabLink
              url={t.tabUrl}
              text="Tab"
              of={t.name}
              missing="No public tab"
              // 24px tall, the WCAG 2.2 target minimum (axe, Task 6).
              className="inline-flex min-h-6 items-center"
            />
          </div>
        </li>
      ))}
      {row.moreTournaments > 0 ? (
        <li className="text-caption text-ink-soft">+{row.moreTournaments} more</li>
      ) : null}
    </ul>
  );
}
