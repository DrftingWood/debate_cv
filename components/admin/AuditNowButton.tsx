'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { auditFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/** "Audited 1 tournament" / "Audited 12 tournaments". */
export function auditedTitle(n: number): string {
  return `Audited ${n.toLocaleString('en-GB')} ${n === 1 ? 'tournament' : 'tournaments'}`;
}

/**
 * "Audit now": one bounded batch of the tournaments never audited or not
 * audited in 24 hours (POST /api/admin/audit {stale:true}); the cron sweeps
 * the rest. Reads the stored data only, so nothing to confirm. The count is
 * a toast, as passive news; a refusal stays on screen (UX-20).
 */
export function AuditNowButton({
  tournamentId,
  tournamentName,
}: {
  /** Audit just this tournament ("Audit again") instead of the stale batch. */
  tournamentId?: string;
  tournamentName?: string;
} = {}) {
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
        postJson<{ audited: number }>(
          '/api/admin/audit',
          tournamentId ? { tournamentId } : { stale: true },
        ),
      );
      if (!result) return;
      if (!result.ok) {
        setError(auditFailureMessage(result));
        return;
      }
      toast.show({ kind: 'success', title: auditedTitle(result.data.audited ?? 0) });
      startTransition(() => router.refresh());
    });
  };

  const view = tournamentId
    ? {
        label: 'Audit again',
        busyLabel: 'Auditing…',
        status: `Auditing ${tournamentName ?? 'this tournament'}.`,
      }
    : {};
  return <AuditNowView pending={pending} error={error} onRun={run} {...view} />;
}

/**
 * The button and its status line, apart from the request so a server render
 * can show the pending state. A batch can take most of a minute, so the
 * status line says what is happening (UX-22); it exists empty from the first
 * render so its text is announced (UX-19).
 */
export function AuditNowView({
  pending,
  error,
  onRun,
  label = 'Audit now',
  busyLabel = 'Auditing…',
  status = 'Auditing the tournaments not checked in 24 h. This can take up to a minute.',
}: {
  pending: boolean;
  error: string | null;
  onRun: () => void;
  label?: string;
  busyLabel?: string;
  /** The status line while it runs (UX-22). */
  status?: string;
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
        leftIcon={<ArrowsClockwise className="h-4 w-4" aria-hidden />}
        aria-describedby={error ? errorId : pending ? statusId : undefined}
        onClick={onRun}
      >
        {pending ? busyLabel : label}
      </Button>
      <p
        id={statusId}
        role="status"
        className="max-w-64 text-right text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending ? status : null}
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
