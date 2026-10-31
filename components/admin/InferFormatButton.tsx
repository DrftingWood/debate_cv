'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkle } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { RescrapeSuggestedButton } from '@/components/admin/RescrapeSuggestedButton';
import { usePageFlight } from '@/components/admin/pageFlight';
import type { SuggestedPiece } from '@/lib/admin/accuracyActions';
import { formatFailureMessage } from '@/lib/admin/actionMessage';
import { inferredWords, UNDECIDED_WORDS, type InferResponse } from '@/lib/admin/formatFillText';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * "Fix" for a missing format: reads the tournament's stored rounds and team
 * sizes and writes the format they decide (POST /api/admin/formats), with no
 * fetch, and the route re-audits so the score is right when the page
 * refreshes. When the stored data cannot decide, the answer is not a failure
 * but a next step: the same pieces the check suggests (R1 and the team tab)
 * are offered to re-scrape, through the existing button.
 *
 * Runs through the page's single flight when there is one (the detail page's
 * CheckActionsProvider), so it never overlaps a mark or a re-scrape; the
 * Inbox keeps a flight of its own. Success is a toast; a refusal stays as an
 * alert until the next press (UX-20).
 */
export function InferFormatButton({
  tournamentId,
  tournamentName,
  pieces,
}: {
  tournamentId: string;
  tournamentName: string;
  pieces: readonly SuggestedPiece[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [undecided, setUndecided] = useState(false);
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const result = await flight.run(() =>
        postJson<InferResponse>('/api/admin/formats', { tournamentId }),
      );
      if (!result) return;
      if (!result.ok) {
        setError(formatFailureMessage(result));
        return;
      }
      setUndecided(!result.data.decided);
      if (!result.data.decided) return;
      toast.show({
        kind: 'success',
        title: tournamentName,
        description: inferredWords(result.data.format),
      });
      startTransition(() => router.refresh());
    });
  };

  return (
    <InferFormatView
      tournamentId={tournamentId}
      tournamentName={tournamentName}
      pieces={pieces}
      pending={pending}
      error={error}
      undecided={undecided}
      onRun={run}
    />
  );
}

/**
 * The button, its status line, the undecided note and the error, apart from
 * the request so a server render can show each state. The status element is
 * there from the first render, empty, so its words are announced (UX-19).
 */
export function InferFormatView({
  tournamentId,
  tournamentName,
  pieces,
  pending,
  error,
  undecided,
  onRun,
}: {
  tournamentId: string;
  tournamentName: string;
  pieces: readonly SuggestedPiece[];
  pending: boolean;
  error: string | null;
  undecided: boolean;
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
        leftIcon={<Sparkle className="h-4 w-4" aria-hidden />}
        aria-label={
          pending
            ? `Inferring the format of ${tournamentName}`
            : `Fix: infer the format of ${tournamentName}`
        }
        aria-describedby={error ? errorId : pending ? statusId : undefined}
        onClick={onRun}
      >
        {pending ? 'Inferring…' : 'Fix'}
      </Button>
      <p
        id={statusId}
        role="status"
        className="max-w-64 text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending ? `Reading the format of ${tournamentName} from the stored rounds.` : null}
      </p>
      {undecided ? (
        <Undecided tournamentId={tournamentId} tournamentName={tournamentName} pieces={pieces} />
      ) : null}
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

/** The stored data could not decide: say so, and offer the pages to re-read. */
function Undecided({
  tournamentId,
  tournamentName,
  pieces,
}: {
  tournamentId: string;
  tournamentName: string;
  pieces: readonly SuggestedPiece[];
}) {
  return (
    <>
      <p className="max-w-64 text-caption whitespace-normal text-ink-soft">{UNDECIDED_WORDS}</p>
      <RescrapeSuggestedButton
        tournamentId={tournamentId}
        tournamentName={tournamentName}
        suggested={pieces}
      />
    </>
  );
}
