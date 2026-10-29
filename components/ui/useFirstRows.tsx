'use client';

import { useState, type ReactNode } from 'react';
import { usePrinting } from '@/components/ui/Deferred';

/**
 * The first `n` rows of a long table, with a control for the rest (owner
 * rule 2026-10-29: about 20 results to a page). The table renders `shown`;
 * the caller places `more` under it. Print shows every row, as the Record
 * does.
 */
export function useFirstRows<T>(
  rows: readonly T[],
  n = 20,
): { shown: readonly T[]; more: ReactNode } {
  const [all, setAll] = useState(false);
  const printing = usePrinting();
  if (rows.length <= n) return { shown: rows, more: null };
  const open = all || printing;
  return {
    shown: open ? rows : rows.slice(0, n),
    more: (
      <div className="border-t border-border px-4 py-inline" data-print-hide="true">
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={open}
          className="text-caption font-medium text-primary hover:underline coarse:min-h-11"
        >
          {open ? `Show the first ${n}` : `Show all ${rows.length}`}
        </button>
      </div>
    ),
  };
}
