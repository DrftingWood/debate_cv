'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { formatFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { usePageFlight } from '@/components/admin/pageFlight';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * "Fix" for the Old parser finding: the same refresh as the Tools tab's
 * "Refresh old-parser tournaments", for this one tournament (POST
 * /api/admin/old-parser { tournamentId }): every recorded page is read again
 * and the refresh is recorded only when all of them loaded. The route
 * re-audits, so the finding clears when the page refreshes. A refresh that
 * did not complete is said plainly and stays a warning; it is not an error
 * of the request.
 */
export function RefreshOldFixButton({
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
  const [incomplete, setIncomplete] = useState(false);
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    setIncomplete(false);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<{ result: 'refreshed' | 'failed' }>('/api/admin/old-parser', { tournamentId }),
      );
      if (!res) return;
      if (!res.ok) {
        setError(formatFailureMessage(res));
        return;
      }
      if (res.data.result === 'failed') {
        setIncomplete(true);
        return;
      }
      toast.show({
        kind: 'success',
        title: tournamentName,
        description: 'Every recorded page was read again.',
      });
      startTransition(() => router.refresh());
    });
  };

  return (
    <RefreshOldFixView
      tournamentName={tournamentName}
      pending={pending}
      error={error}
      incomplete={incomplete}
      onRun={run}
    />
  );
}

/** The button, its status line and the words after an incomplete refresh, apart from the request. */
export function RefreshOldFixView({
  tournamentName,
  pending,
  error,
  incomplete,
  onRun,
}: {
  tournamentName: string;
  pending: boolean;
  error: string | null;
  incomplete: boolean;
  onRun: () => void;
}) {
  const errorId = useId();
  const statusId = useId();
  return (
    <div className="flex flex-col items-start gap-hair">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        leftIcon={<ArrowClockwise className="h-4 w-4" aria-hidden />}
        aria-label={
          pending
            ? `Refreshing ${tournamentName}`
            : `Fix: read every recorded page of ${tournamentName} again`
        }
        aria-describedby={error ? errorId : pending ? statusId : undefined}
        onClick={onRun}
      >
        {pending ? 'Refreshing…' : 'Fix'}
      </Button>
      <p
        id={statusId}
        role="status"
        className="max-w-64 text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending
          ? `Reading every recorded page of ${tournamentName} again. This can take up to a minute.`
          : incomplete
            ? 'Not every page could be read, so nothing was recorded. Try again later.'
            : null}
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
