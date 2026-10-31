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
 * A phone has no hover, so the trigger is a button: a tap pins the list open
 * and another tap (or Escape, or a tap elsewhere) puts it away, with
 * `aria-expanded` saying which. Hover and keyboard focus still show it.
 *
 * A stored tournament's "Open" goes to its admin page, named for the
 * tournament when the row knows it (UX-11). A cell whose tournament name
 * already links there passes `open={false}`, so the row has one link, not two.
 *
 * "? Check" (Task 5d) is an address that matched two stored tournaments or
 * none it could name: stored or not is unknown, so it is neither a tick nor
 * a cross, and its reason is revealed the way a partial tab's pages are.
 */
export function TabStatus({
  tab,
  name,
  open: withOpen = true,
}: {
  tab: TabState;
  name?: string;
  open?: boolean;
}) {
  if (tab.state === 'missing') {
    return (
      <span className="whitespace-nowrap text-ink-soft">
        <span aria-hidden>✗</span> Not loaded
      </span>
    );
  }
  const open =
    withOpen && tab.tournamentId ? (
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

  return (
    <div>
      <HoverList
        word={tab.state === 'check' ? 'Check' : 'Partly'}
        lines={tab.errors}
        className={tab.state === 'check' ? 'text-ink' : 'text-warning'}
      />
      <div>{open}</div>
    </div>
  );
}

/**
 * "? Partly" or "? Check" and the lines behind it: a Tooltip for the pointer
 * and keyboard focus, and the same lines as an sr-only list the trigger
 * describes itself with (UX-36).
 */
function HoverList({
  word,
  lines,
  className,
}: {
  word: string;
  lines: readonly string[];
  className: string;
}) {
  const listId = useId();
  const items = lines.map((e, i) => <li key={`${i}:${e}`}>{e}</li>);
  return (
    <>
      <Tooltip
        content={<ul className="space-y-hair">{items}</ul>}
        side="bottom"
        align="start"
        wrap
        fixed
      >
        {({ pinned, togglePin }) => (
          <button
            type="button"
            aria-expanded={pinned}
            aria-describedby={listId}
            onClick={togglePin}
            className={`inline-flex min-h-6 cursor-help items-center whitespace-nowrap rounded-sm text-left underline decoration-dotted underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
          >
            <span aria-hidden>?</span>&nbsp;{word}
          </button>
        )}
      </Tooltip>
      {/* Outside the trigger, so the description is not part of its name. */}
      <ul id={listId} className="sr-only">
        {items}
      </ul>
    </>
  );
}
