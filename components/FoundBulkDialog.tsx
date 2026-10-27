'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { rowLabel, type RowView } from '@/lib/discovery/view';

/**
 * The bulk "This is me" confirmation for Strong matches (owner's rule: bulk
 * only through a dialog that lists every row). Modal per the APG dialog
 * pattern, as CvRowReportButton is: named, focus moved in and trapped,
 * Escape closes, and the caller returns focus to the trigger. Initial focus
 * is Cancel, the safe choice (UX-17).
 */
export function FoundBulkDialog({
  rows,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  rows: readonly RowView[];
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeydown);
    };
  }, [onClose]);

  const n = rows.length;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="found-bulk-title"
      aria-describedby="found-bulk-desc"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="found-bulk-title" className="font-display text-h4 font-medium text-ink">
          Mark {n} strong {n === 1 ? 'match' : 'matches'} as you?
        </h2>
        <p id="found-bulk-desc" className="text-ui text-ink-soft">
          Each of these has your name and one of your teammates. Nothing is added to your record
          yet; you can undo any of them afterwards.
        </p>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {rows.map((row) => (
            <li key={row.key} className="px-3 py-2">
              <div className="font-medium text-ink">{rowLabel(row)}</div>
              <div className="text-caption text-ink-soft">
                Listed as &ldquo;{row.listedName}&rdquo;
                {row.role ? ` · ${row.role}` : ''}
              </div>
              <div className="text-caption text-ink-soft">{row.evidence}</div>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={onConfirm}>
            Mark these {n} as me
          </Button>
        </div>
      </div>
    </div>
  );
}
