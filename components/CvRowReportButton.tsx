'use client';

/**
 * Per-row "Report" trigger that lives inside each tournament row in the CV
 * speaking + judging tables. Replaces the previous global multi-select form
 * — when a user spots something wrong on a specific row, they don't have to
 * scroll to a separate section and find that tournament in a checkbox list.
 *
 * Hits the same /api/cv/error-report endpoint as the old form, just with
 * exactly one tournamentId selected. The endpoint already accepts that shape.
 */
import { useState, useTransition } from 'react';
import { AlertCircle, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ReportResponse = {
  id: string;
  tournamentCount: number;
};

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
  const [isPending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setComment('');
  };

  return (
    <>
      <Button
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
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const result = await postJson<ReportResponse>('/api/cv/error-report', {
                    tournamentIds: [tournamentId],
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
              <textarea
                value={comment}
                onChange={(e) => setComment(e.currentTarget.value)}
                rows={4}
                maxLength={4000}
                placeholder="Tell us what looks wrong about this tournament's data."
                className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  loading={isPending}
                  disabled={comment.trim().length < 8}
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
