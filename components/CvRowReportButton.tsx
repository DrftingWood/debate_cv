'use client';

/**
 * Per-row "Report" trigger that lives inside each tournament row in the CV
 * speaking + judging tables. Surfaces a structured checklist of common
 * issues plus an optional free-text comment, so the admin queue gets
 * categorised reports instead of "speaker rank is missing, also I won the
 * tournament" prose mixing two distinct issues.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { AlertCircle, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ReportResponse = {
  id: string;
  tournamentCount: number;
};

const CATEGORIES: { code: string; label: string }[] = [
  { code: 'wrong_teammate', label: 'Wrong teammate / teammate missing' },
  { code: 'wrong_speaker_rank', label: 'Wrong speaker rank / rank missing' },
  { code: 'wrong_speaker_average', label: 'Wrong speaker average / average missing' },
  { code: 'wrong_team_result', label: 'Wrong team result (rank, points, win/loss)' },
  { code: 'wrong_outround', label: 'Wrong outround / Champion marker' },
  { code: 'wrong_identity', label: "I didn't speak/judge at this tournament" },
  { code: 'other', label: 'Other (describe in comment)' },
];

export function CvRowReportButton({
  tournamentId,
  tournamentName,
}: {
  tournamentId: string;
  tournamentName: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setComment('');
    setSelected(new Set());
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
      const autofocusTarget =
        dialogEl.querySelector<HTMLElement>('input,button,[href],textarea,select');
      autofocusTarget?.focus();
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeydown);
    };
  }, [open, close]);

  // Submit is enabled when either ≥1 category is ticked, OR the comment has
  // enough text to be useful on its own. The endpoint enforces the same
  // constraint server-side.
  const canSubmit = selected.size > 0 || comment.trim().length >= 8;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="ghost"
        leftIcon={<AlertCircle className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => setOpen(true)}
        title={`Report a problem with ${tournamentName}`}
      >
        Report
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
                <h2 className="font-display text-h4 font-semibold text-foreground">
                  Report a problem
                </h2>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {tournamentName}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const result = await postJson<ReportResponse>('/api/cv/error-report', {
                    tournamentIds: [tournamentId],
                    categories: [...selected],
                    comment,
                  });
                  if (!result.ok) {
                    toast.show({
                      kind: 'error',
                      title: 'Report not sent',
                      description: result.error,
                    });
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
                <legend className="mb-1 text-[12px] font-medium text-foreground">
                  What looks wrong?
                </legend>
                <ul className="space-y-1">
                  {CATEGORIES.map((cat) => {
                    const checked = selected.has(cat.code);
                    return (
                      <li key={cat.code}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 hover:bg-muted/40">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-primary/40"
                            checked={checked}
                            onChange={() => toggleCategory(cat.code)}
                          />
                          <span className="text-[13px] text-foreground">{cat.label}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <div className="space-y-1">
                <label
                  htmlFor={`report-comment-${tournamentId}`}
                  className="block text-[12px] font-medium text-foreground"
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
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  loading={isPending}
                  disabled={!canSubmit}
                  leftIcon={!isPending ? <Send className="h-3.5 w-3.5" aria-hidden /> : undefined}
                >
                  Send
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
