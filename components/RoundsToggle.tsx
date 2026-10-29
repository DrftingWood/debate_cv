'use client';

import { useState } from 'react';
import { CaretDown } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils/cn';

/**
 * The caret at the start of a speaking-ledger row that shows its rounds
 * (owner, 2026-10-29: the full-width "Round ledger" line under every row was
 * an extra widget; the control belongs in the row it opens). It toggles the
 * `hidden` of the detail row that follows, named by `controls`.
 *
 * A disclosure button (APG): `aria-expanded` carries the state and the
 * accessible name says which tournament's rounds it opens. The detail row
 * starts hidden in the server HTML, so without JS the rounds stay folded on
 * screen; print shows every one regardless (globals.css, `data-rounds`).
 */
export function RoundsToggle({
  controls,
  tournamentName,
  rounds,
}: {
  /** Id of the detail <tr>. */
  controls: string;
  tournamentName: string;
  rounds: number;
}) {
  const [open, setOpen] = useState(false);
  // A fixed name: aria-expanded already says open or closed, and a name that
  // flips between "Show" and "Hide" would announce the state twice.
  const label = `Rounds of ${tournamentName} (${rounds})`;
  return (
    <Tooltip content={open ? 'Hide rounds' : 'Show rounds'} side="top">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        aria-label={label}
        onClick={() => {
          const next = !open;
          const row = document.getElementById(controls);
          if (row) row.hidden = !next;
          setOpen(next);
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-surface-2 coarse:h-11 coarse:w-11"
      >
        <CaretDown
          className={cn(
            'h-4 w-4 -rotate-90 transition-transform duration-180 motion-reduce:transition-none',
            open && 'rotate-0',
          )}
          aria-hidden
        />
      </button>
    </Tooltip>
  );
}
