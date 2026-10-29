'use client';

/**
 * Per-row "Report" trigger that lives inside each tournament row in the CV
 * speaking + judging tables. Surfaces a structured checklist of common
 * issues plus an optional free-text comment, so the admin queue gets
 * categorised reports instead of "speaker rank is missing, also I won the
 * tournament" prose mixing two distinct issues.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { PaperPlaneTilt, WarningCircle, X } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';
import { CATEGORY_LONG_LABELS, REPORT_CATEGORIES } from '@/lib/cvErrorReports/categories';

type ReportResponse = {
  id: string;
  tournamentCount: number;
};

const CATEGORIES = REPORT_CATEGORIES.map((code) => ({
  code,
  label: CATEGORY_LONG_LABELS[code],
}));

/** The comment length that makes a report useful without a ticked category. */
export const MIN_COMMENT_CHARS = 8;

/**
 * Why the form cannot be sent yet, or null when it can. The endpoint enforces
 * the same rule; saying it here, on submit, replaces a Send button that was
 * silently disabled with no reason anywhere on screen (FORM-7, UX-16).
 */
export function reportValidationError(selectedCount: number, comment: string): string | null {
  if (selectedCount > 0 || comment.trim().length >= MIN_COMMENT_CHARS) return null;
  return `Tick at least one problem, or describe it in ${MIN_COMMENT_CHARS} characters or more.`;
}

/**
 * A failed send in words a user can act on. `postJson` hands back the
 * server's error code ("bad_request", "no_accessible_tournaments") or a
 * network message, none of which belong on screen (DASH-5).
 */
export function reportFailureMessage(status: number): string {
  if (status === 0) return 'Could not reach the server. Check your connection and try again.';
  if (status === 401) return 'Your session has ended. Sign in again, then send the report.';
  if (status === 429) return 'You have sent a lot of reports in the last hour. Try again later.';
  if (status === 400) {
    return 'This report could not be filed against this tournament. Reload the page and try again.';
  }
  return 'Something went wrong on our side. Try again in a moment.';
}

export function CvRowReportButton({
  tournamentId,
  tournamentName,
  /**
   * Drop the "Report" label and render the icon alone. The desktop ledger
   * is already wider than a 1440px viewport, and a labelled ghost button
   * in every row cost ~60px of a column that carries no data — the icon
   * plus its title/aria-label says the same thing. The mobile cards, which
   * have the room and no column budget, keep the word.
   */
  iconOnly = false,
}: {
  tournamentId: string;
  tournamentName: string;
  iconOnly?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Shown inside the dialog, never as a toast: the toast region sits outside
  // this aria-modal dialog, where VoiceOver does not read, and it vanished
  // after 5 s (FORM-12).
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setComment('');
    setSelected(new Set());
    setError(null);
    triggerRef.current?.focus();
  }, []);

  const toggleCategory = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
    const dialogEl = dialogRef.current;
    if (dialogEl) {
      const autofocusTarget = dialogEl.querySelector<HTMLElement>(
        'input,button,[href],textarea,select',
      );
      autofocusTarget?.focus();
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeydown);
    };
  }, [open, close]);

  const errorId = `report-error-${tournamentId}`;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="ghost"
        leftIcon={iconOnly ? undefined : <WarningCircle className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => setOpen(true)}
        title={`Report a problem with ${tournamentName}`}
        // Always named for its row: on the mobile cards every button read
        // just "Report" (CV-12). The name still starts with the visible word.
        aria-label={`Report a problem with ${tournamentName}`}
        data-print-hide="true"
      >
        {iconOnly ? <WarningCircle className="h-3.5 w-3.5" aria-hidden /> : 'Report'}
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Report a problem with ${tournamentName}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          onClick={close}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-md space-y-3 rounded-card border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-h4 font-medium text-ink">Report a problem</h2>
                <p className="mt-0.5 text-caption text-ink-soft">{tournamentName}</p>
              </div>
              <button
                type="button"
                onClick={close}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const invalid = reportValidationError(selected.size, comment);
                if (invalid) {
                  setError(invalid);
                  return;
                }
                setError(null);
                startTransition(async () => {
                  const result = await postJson<ReportResponse>('/api/cv/error-report', {
                    tournamentIds: [tournamentId],
                    categories: [...selected],
                    comment,
                  });
                  if (!result.ok) {
                    setError(`Report not sent. ${reportFailureMessage(result.status)}`);
                    return;
                  }
                  toast.show({
                    kind: 'success',
                    title: 'Report sent',
                    description: `Thanks — we'll look at ${tournamentName}.`,
                  });
                  close();
                });
              }}
            >
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-caption font-medium text-ink">
                  What looks wrong?
                </legend>
                <ul className="space-y-1">
                  {CATEGORIES.map((cat) => {
                    const checked = selected.has(cat.code);
                    return (
                      <li key={cat.code}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                          {/* accent-primary, not text-primary: the latter
                              needs @tailwindcss/forms, which is not
                              installed, so the box rendered browser blue
                              (FORM-8). */}
                          <input
                            type="checkbox"
                            className="mt-0.5 h-6 w-6 shrink-0 accent-primary"
                            checked={checked}
                            onChange={() => toggleCategory(cat.code)}
                          />
                          <span className="text-table text-ink">{cat.label}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <div className="space-y-1">
                <label
                  htmlFor={`report-comment-${tournamentId}`}
                  className="block text-caption font-medium text-ink"
                >
                  Anything else? (optional)
                </label>
                <textarea
                  id={`report-comment-${tournamentId}`}
                  value={comment}
                  onChange={(e) => setComment(e.currentTarget.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="Add detail — what did you expect to see, what's actually shown?"
                  // border-input, not the hairline table rule; and no
                  // outline-none, so the global :focus-visible outline
                  // shows instead of a 1.2:1 ring (FORM-5, FORM-6).
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base text-ink shadow-xs md:text-table transition-colors placeholder:text-ink-soft focus:border-primary"
                />
              </div>
              {error ? (
                <p id={errorId} role="alert" className="text-caption text-neg">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  loading={isPending}
                  aria-describedby={error ? errorId : undefined}
                  leftIcon={
                    !isPending ? <PaperPlaneTilt className="h-3.5 w-3.5" aria-hidden /> : undefined
                  }
                >
                  Send report
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
