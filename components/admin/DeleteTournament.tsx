'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { deleteFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { usePageFlight } from '@/components/admin/pageFlight';
import { singleFlight } from '@/lib/utils/singleFlight';
import { adminTabHref } from '@/lib/admin/adminTabs';

/**
 * The detail page's "Delete tournament" (POST
 * /api/admin/tournaments/[id]/delete). The first press only asks; the
 * second deletes, and its tab address goes on the Tools tab's list so it is
 * never ingested again. Asked on the page, not in a browser dialog. A
 * tournament on anyone's CV is refused by the route, and the refusal stays
 * on screen. Success is a toast and the Tournaments tab.
 */
export function DeleteTournament({
  tournamentId,
  tournamentName,
  onCvs,
}: {
  tournamentId: string;
  tournamentName: string;
  /** Users with it on their CV, from the audit; null when not audited. */
  onCvs: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<{ deleted: boolean; name: string }>(
          `/api/admin/tournaments/${tournamentId}/delete`,
          { confirm: true },
        ),
      );
      if (!res) return;
      if (!res.ok) {
        setError(deleteFailureMessage(res));
        return;
      }
      toast.show({
        kind: 'success',
        title: tournamentName,
        description: 'Deleted. It will not be ingested again.',
      });
      router.push(adminTabHref('tournaments'));
    });
  };

  return (
    <DeleteTournamentView
      tournamentName={tournamentName}
      onCvs={onCvs}
      asking={asking}
      pending={pending}
      error={error}
      onAsk={() => setAsking(true)}
      onCancel={() => {
        setAsking(false);
        setError(null);
      }}
      onRun={run}
    />
  );
}

/** The words, the buttons and the error, apart from the request so a server render can show each state. */
export function DeleteTournamentView({
  tournamentName,
  onCvs,
  asking,
  pending,
  error,
  onAsk,
  onCancel,
  onRun,
}: {
  tournamentName: string;
  onCvs: number | null;
  asking: boolean;
  pending: boolean;
  error: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onRun: () => void;
}) {
  const errorId = useId();
  return (
    <section
      aria-labelledby="delete-heading"
      className="space-y-inline rounded-lg border border-destructive/30 p-panel"
    >
      <h2 id="delete-heading" className="font-display text-h3 font-medium text-ink">
        Delete tournament
      </h2>
      <p className="max-w-prose text-body text-ink-soft">
        For a demo or test tab that is not a real tournament. Deletes everything stored for it and
        notes its tab address on the Tools tab, so it is never ingested again until you allow it.
      </p>
      <DeleteBody
        tournamentName={tournamentName}
        onCvs={onCvs}
        asking={asking}
        pending={pending}
        describedBy={error ? errorId : undefined}
        onAsk={onAsk}
        onCancel={onCancel}
        onRun={onRun}
      />
      {error ? (
        <p id={errorId} role="alert" className="max-w-prose text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** What the section offers: why it cannot delete, the question, or the first button. */
function DeleteBody({
  tournamentName,
  onCvs,
  asking,
  pending,
  describedBy,
  onAsk,
  onCancel,
  onRun,
}: {
  tournamentName: string;
  onCvs: number | null;
  asking: boolean;
  pending: boolean;
  describedBy: string | undefined;
  onAsk: () => void;
  onCancel: () => void;
  onRun: () => void;
}) {
  const blocked = onCvs != null && onCvs > 0;
  return blocked ? (
    <p className="max-w-prose text-body text-ink">
      It is on {onCvs === 1 ? 'one user’s CV' : `${onCvs} users’ CVs`}, so it cannot be deleted.
      Ignore it in admin stats instead.
    </p>
  ) : asking ? (
    <div className="space-y-inline">
      <p className="max-w-prose text-body text-ink">
        Delete {tournamentName}? This cannot be undone: allowing it again later only lets a new
        import store it afresh.
      </p>
      <div className="flex flex-wrap gap-inline">
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={pending}
          aria-describedby={describedBy}
          onClick={onRun}
        >
          Delete permanently
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Delete tournament: ${tournamentName}`}
      onClick={onAsk}
    >
      Delete tournament
    </Button>
  );
}
