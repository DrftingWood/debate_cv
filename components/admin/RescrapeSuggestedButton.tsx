'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { rescrapeSummary, type RescrapeResponse } from '@/components/admin/RetryPiecesButton';
import { rescrapeAction, type SuggestedPiece } from '@/lib/admin/accuracyActions';
import { rescrapeFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * "Re-scrape suggested (n)" on a low-scoring tournament: re-fetches the
 * pieces its failing and warning checks point at, through the same route
 * and with the same pending, status-line and error handling as "Retry
 * failed" beside the partly loaded tournaments. With nothing suggested it
 * re-scrapes the failed pieces instead (rescrapeAction).
 *
 * Not destructive (a piece that fails again keeps the rows it had), so no
 * confirmation. Success is a toast; a refusal stays beside the button as an
 * alert until the next press (UX-20).
 */
export function RescrapeSuggestedButton({
  tournamentId,
  tournamentName,
  suggested,
  asFix = false,
}: {
  tournamentId: string;
  tournamentName: string;
  suggested: readonly SuggestedPiece[];
  asFix?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flight] = useState(singleFlight);
  const action = rescrapeAction(suggested);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const result = await flight.run(() =>
        postJson<RescrapeResponse>(`/api/admin/tournaments/${tournamentId}/rescrape`, action.body),
      );
      if (!result) return;
      if (!result.ok) {
        setError(rescrapeFailureMessage(result));
        return;
      }
      toast.show({
        kind: 'success',
        title: tournamentName,
        description: rescrapeSummary(result.data),
      });
      // Its own transition, so `pending` holds until the refreshed row lands.
      startTransition(() => router.refresh());
    });
  };

  return (
    <RescrapeSuggestedView
      tournamentName={tournamentName}
      suggested={suggested}
      pending={pending}
      error={error}
      onRun={run}
      asFix={asFix}
    />
  );
}

/**
 * The button, its status line and its error, apart from the request so a
 * server render can show each state. The status element is there from the
 * first render, empty, so its text is announced when it appears (UX-19).
 */
export function RescrapeSuggestedView({
  tournamentName,
  suggested,
  pending,
  error,
  onRun,
  asFix = false,
}: {
  tournamentName: string;
  suggested: readonly SuggestedPiece[];
  pending: boolean;
  error: string | null;
  onRun: () => void;
  /** The Inbox's "Fix": that word on the button, the re-scrape named in its accessible name. */
  asFix?: boolean;
}) {
  const errorId = useId();
  const statusId = useId();
  const action = rescrapeAction(suggested);
  // In a left-aligned cell the words under the button start at its edge.
  const align = asFix ? 'text-left' : 'text-right';
  return (
    <div className={`flex flex-col gap-hair ${asFix ? 'items-start' : 'items-end'}`}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        leftIcon={<ArrowClockwise className="h-4 w-4" aria-hidden />}
        aria-label={
          pending
            ? `Re-scraping ${tournamentName}`
            : asFix
              ? `Fix: ${action.name(tournamentName)}`
              : action.name(tournamentName)
        }
        aria-describedby={error ? errorId : pending ? statusId : undefined}
        onClick={onRun}
      >
        {pending ? action.busyLabel : asFix ? 'Fix' : action.label}
      </Button>
      <p
        id={statusId}
        role="status"
        className={`max-w-64 ${align} text-caption whitespace-normal text-ink-soft empty:hidden`}
      >
        {pending ? action.status(tournamentName) : null}
      </p>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className={`max-w-64 ${align} text-caption whitespace-normal text-destructive`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
