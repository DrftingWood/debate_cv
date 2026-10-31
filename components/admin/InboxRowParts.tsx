'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { InferFormatButton } from '@/components/admin/InferFormatButton';
import { InboxRetryButton } from '@/components/admin/InboxRetryButton';
import { RefreshOldFixButton } from '@/components/admin/RefreshOldFixButton';
import { RescrapeSuggestedButton } from '@/components/admin/RescrapeSuggestedButton';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
import type { InboxRow } from '@/components/admin/InboxTable';
import type { useMarkChecked } from '@/components/admin/useMarkChecked';
import { PRIORITY_LABEL } from '@/lib/admin/reviewSetTypes';

/**
 * The cells of an Inbox row that have more in them than a value: the name
 * with its status, what is wrong with its badges, and the actions with the
 * row menu. Apart from InboxTable.tsx for the size of that file.
 */

export function RowActions({
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

/** "Fix", by what the item's fix is: a re-scrape, an inferred format, a retry, or a place to go. */
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
  if (fix.type === 'infer_format') {
    return (
      <InferFormatButton
        tournamentId={fix.tournamentId}
        tournamentName={row.name}
        pieces={fix.pieces}
      />
    );
  }
  if (fix.type === 'refresh_old') {
    return <RefreshOldFixButton tournamentId={fix.tournamentId} tournamentName={row.name} />;
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
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  if (!row.tabUrl && !row.tournamentId) return null;
  return (
    <details
      ref={menu}
      className="text-table"
      onKeyDown={(e) => {
        // Escape puts the list away and returns to the button that opened it.
        if (e.key !== 'Escape' || !menu.current?.open) return;
        e.preventDefault();
        menu.current.open = false;
        summary.current?.focus();
      }}
    >
      <summary
        ref={summary}
        aria-label={`More actions for ${row.name}`}
        className={`${buttonClasses({ variant: 'ghost', size: 'sm' })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        More
      </summary>
      <div
        className="mt-hair flex flex-col items-start gap-hair"
        onClick={(e) => {
          // Following a link in the list puts it away (the page keeps its place).
          if (menu.current && (e.target as HTMLElement).closest('a')) menu.current.open = false;
        }}
      >
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
export function NameAndStatus({ row }: { row: InboxRow }) {
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
export function WhatIsWrong({ row }: { row: InboxRow }) {
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
