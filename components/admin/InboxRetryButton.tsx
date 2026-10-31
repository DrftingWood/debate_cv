'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { retryFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * The Inbox's "Fix" for a failed import: puts the group's jobs back on the
 * queue through the same route as "Retry selected". Not destructive (the
 * worker just tries the address again), so no confirmation. Success is a
 * toast and a refresh; a refusal stays beside the button as an alert until
 * the next press (UX-20), and the status line is there from the first
 * render, empty, so its words are announced (UX-19).
 */
export function InboxRetryButton({
  jobIds,
  subject,
}: {
  jobIds: readonly string[];
  /** What the row is about, for the accessible name (UX-11). */
  subject: string;
}) {
  const retry = useRetry(jobIds, subject);
  const errorId = useId();
  const statusId = useId();
  const { pending, error } = retry;
  return (
    <div className="flex flex-col items-start gap-hair">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        leftIcon={<ArrowsClockwise className="h-4 w-4" aria-hidden />}
        aria-label={pending ? `Retrying ${subject}` : `Fix: retry ${subject}`}
        aria-describedby={error ? errorId : pending ? statusId : undefined}
        onClick={retry.run}
      >
        {pending ? 'Retrying…' : 'Fix'}
      </Button>
      <p
        id={statusId}
        role="status"
        className="max-w-64 text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending ? `Queuing ${subject} again.` : null}
      </p>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="max-w-64 text-caption whitespace-normal text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The retry call and its outcome, one at a time (UX-17). */
function useRetry(jobIds: readonly string[], subject: string) {
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
        postJson<{ requeued: number; skippedLocked: number }>('/api/admin/jobs/retry', {
          ids: jobIds,
        }),
      );
      if (!result) return;
      if (!result.ok) {
        setError(retryFailureMessage(result));
        return;
      }
      toast.show({
        kind: 'success',
        title: subject,
        description:
          result.data.requeued > 0
            ? 'Queued again. It runs with the next queue drain.'
            : 'Nothing was queued: the import is locked or already running.',
      });
      // Its own transition, so `pending` holds until the refreshed row lands.
      startTransition(() => router.refresh());
    });
  };
  return { run, pending, error };
}
