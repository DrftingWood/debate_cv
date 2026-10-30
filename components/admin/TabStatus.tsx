import { useId } from 'react';
import Link from 'next/link';
import { Tooltip } from '@/components/ui/Tooltip';
import type { TabState } from '@/lib/admin/tabStatus';

/**
 * The "Tab" cell (owner, 2026-10-31: "tick if fully loaded in tab, ? if
 * partially load (hover to see the errors) and X if not loaded"). The
 * symbol is the glance; the word beside it carries the meaning, so neither
 * colour nor a glyph is the only cue (UX-34), and a screen reader hears
 * "Loaded", not "check mark".
 *
 * "? Partly" holds the list of pages that failed. The visible list is a
 * Tooltip on hover or keyboard focus, and the Tooltip is `aria-hidden`, so
 * the same list is also an sr-only `<ul>` the trigger points at with
 * `aria-describedby` (UX-36: nothing needed lives only on hover), as
 * PartlyLoadedBadge does. The trigger takes focus for that reason. The
 * Tooltip is `fixed`: the cell sits in a scrolling table panel, which would
 * clip an absolutely placed label.
 *
 * A stored tournament's "Open" goes to its admin page, named for the
 * tournament when the row knows it (UX-11).
 */
export function TabStatus({ tab, name }: { tab: TabState; name?: string }) {
  const listId = useId();
  if (tab.state === 'missing') {
    return (
      <span className="whitespace-nowrap text-ink-soft">
        <span aria-hidden>✗</span> Not loaded
      </span>
    );
  }
  const open = tab.tournamentId ? (
    <Link
      href={`/admin/tournaments/${tab.tournamentId}`}
      aria-label={`Open ${name ?? 'the tournament'}`}
      className="inline-flex min-h-6 items-center text-caption text-ink underline underline-offset-4 hover:text-primary"
    >
      Open
    </Link>
  ) : null;

  if (tab.state === 'loaded') {
    return (
      <div>
        <span className="whitespace-nowrap text-ink">
          <span aria-hidden>✓</span> Loaded
        </span>
        <div>{open}</div>
      </div>
    );
  }

  const list = (
    <ul className="space-y-hair">
      {tab.errors.map((e, i) => (
        <li key={`${i}:${e}`}>{e}</li>
      ))}
    </ul>
  );
  return (
    <div>
      <Tooltip content={list} side="bottom" align="start" wrap fixed>
        <span
          tabIndex={0}
          aria-describedby={listId}
          className="inline-flex min-h-6 cursor-help items-center whitespace-nowrap rounded-sm text-warning underline decoration-dotted underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span aria-hidden>?</span>&nbsp;Partly
        </span>
      </Tooltip>
      {/* Outside the trigger, so the description is not part of its name. */}
      <ul id={listId} className="sr-only">
        {tab.errors.map((e, i) => (
          <li key={`${i}:${e}`}>{e}</li>
        ))}
      </ul>
      <div>{open}</div>
    </div>
  );
}
