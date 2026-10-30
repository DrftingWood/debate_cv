'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';
import { rescrapeFailureMessage } from '@/lib/admin/actionMessage';

type RescrapeResponse = {
  loaded: unknown[];
  failed: unknown[];
  notOnTab: unknown[];
};

/** "Loaded 3, still failing 1." with the pieces the tab no longer lists. */
function summary(data: RescrapeResponse): string {
  const gone = data.notOnTab?.length ?? 0;
  return (
    `Loaded ${data.loaded?.length ?? 0}, still failing ${data.failed?.length ?? 0}.` +
    (gone ? ` ${gone} no longer on the tab, so no longer tracked.` : '')
  );
}

/**
 * "Retry failed" for one partly loaded tournament: re-fetches only the
 * pieces that failed, now, instead of waiting for the next cron retry.
 *
 * Not destructive (a piece that fails again keeps the rows it had), so no
 * confirmation. The outcome is a toast when the request ran, since that is
 * passive news; a refusal (a scrape already running, the session gone)
 * stays on screen beside the button as an alert until the next press
 * (UX-20), because it asks the admin to do something.
 */
export function RetryPiecesButton({
  tournamentId,
  tournamentName,
}: {
  tournamentId: string;
  tournamentName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flight] = useState(singleFlight);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const result = await flight.run(() =>
        postJson<RescrapeResponse>(`/api/admin/tournaments/${tournamentId}/rescrape`, {
          pieces: 'failed',
        }),
      );
      if (!result) return;
      if (!result.ok) {
        setError(rescrapeFailureMessage(result));
        return;
      }
      toast.show({ kind: 'success', title: tournamentName, description: summary(result.data) });
      // Inside its own transition so `pending` holds until the refreshed
      // rows arrive; otherwise the old row flashes up as retryable again.
      startTransition(() => router.refresh());
    });
  };

  return (
    <RetryPiecesView
      tournamentName={tournamentName}
      pending={pending}
      error={error}
      onRetry={run}
    />
  );
}

/**
 * The button, its progress line and its error, apart from the request so a
 * server render can show the pending state. A rescrape fetches live pages
 * and can take most of a minute, so a spinner alone would look hung
 * (UX-22): the status line says what is happening and how long it may
 * take. The status element is there from the first render, empty, so its
 * text is announced when it appears (UX-19).
 */
export function RetryPiecesView({
  tournamentName,
  pending,
  error,
  onRetry,
}: {
  tournamentName: string;
  pending: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const errorId = useId();
  const statusId = useId();
  return (
    <div className="flex flex-col items-end gap-hair">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        leftIcon={<ArrowClockwise className="h-4 w-4" aria-hidden />}
        // Starts with the visible words, then says which row (UX-11): twenty
        // buttons all named "Retry failed" cannot be told apart in a
        // screen reader's list of controls.
        aria-label={
          pending
            ? `Retrying failed pieces of ${tournamentName}`
            : `Retry failed pieces of ${tournamentName}`
        }
        aria-describedby={error ? errorId : pending ? statusId : undefined}
        onClick={onRetry}
      >
        {pending ? 'Retrying…' : 'Retry failed'}
      </Button>
      <p
        id={statusId}
        role="status"
        className="max-w-64 text-right text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending
          ? `Re-scraping the failed pages of ${tournamentName}. This can take up to a minute.`
          : null}
      </p>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="max-w-64 text-right text-caption whitespace-normal text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
