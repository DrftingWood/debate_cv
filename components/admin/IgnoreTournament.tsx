'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { formatFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { usePageFlight } from '@/components/admin/pageFlight';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * The detail page's "Ignore in admin stats" / "Stop ignoring" (POST
 * /api/admin/tournaments/[id]/ignore). An ignored tournament, a test or demo
 * one, leaves the admin scores, the Inbox and the tournament list; it stays
 * on every user's own CV. The button states the state it asks for, so a
 * double press cannot flip it back. When the name looks like a test one and
 * the tournament is not yet ignored, a line says so: a suggestion, never an
 * automatic ignore. Success is a toast; a refusal stays as an alert.
 */
export function IgnoreTournament({
  tournamentId,
  tournamentName,
  ignored,
  looksLikeTest,
}: {
  tournamentId: string;
  tournamentName: string;
  ignored: boolean;
  looksLikeTest: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<{ ignored: boolean }>(`/api/admin/tournaments/${tournamentId}/ignore`, {
          ignored: !ignored,
        }),
      );
      if (!res) return;
      if (!res.ok) {
        setError(formatFailureMessage(res));
        return;
      }
      toast.show({
        kind: 'success',
        title: tournamentName,
        description: res.data.ignored ? 'Ignored in admin stats.' : 'Counted in admin stats again.',
      });
      startTransition(() => router.refresh());
    });
  };

  return (
    <IgnoreTournamentView
      tournamentName={tournamentName}
      ignored={ignored}
      looksLikeTest={looksLikeTest}
      pending={pending}
      error={error}
      onRun={run}
    />
  );
}

/** The words, the button and the error, apart from the request so a server render can show each state. */
export function IgnoreTournamentView({
  tournamentName,
  ignored,
  looksLikeTest,
  pending,
  error,
  onRun,
}: {
  tournamentName: string;
  ignored: boolean;
  looksLikeTest: boolean;
  pending: boolean;
  error: string | null;
  onRun: () => void;
}) {
  const errorId = useId();
  const label = ignored ? 'Stop ignoring' : 'Ignore in admin stats';
  return (
    <section aria-labelledby="ignore-heading" className="space-y-inline rounded-lg border p-panel">
      <h2 id="ignore-heading" className="font-display text-h3 font-medium text-ink">
        Admin stats
      </h2>
      <p className="max-w-prose text-body text-ink-soft">
        {ignored
          ? 'This tournament is ignored: it is left out of the scores, the Inbox and the tournament list. Anyone who has it on their CV still sees it there.'
          : 'Ignore a test or demo tournament to leave it out of the scores, the Inbox and the tournament list. It stays on any CV that has it.'}
      </p>
      {looksLikeTest && !ignored ? (
        <p className="max-w-prose text-body text-ink">
          The name looks like a test tournament. Ignore it if it is one.
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        aria-label={`${label}: ${tournamentName}`}
        aria-describedby={error ? errorId : undefined}
        onClick={onRun}
      >
        {label}
      </Button>
      {error ? (
        <p id={errorId} role="alert" className="max-w-prose text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
