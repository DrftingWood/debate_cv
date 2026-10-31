'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkle } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { formatFailureMessage } from '@/lib/admin/actionMessage';
import { FILL_BATCH_SIZE, fillSummary, type FillResponse } from '@/lib/admin/formatFillText';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * Tools: "Fill missing formats". Each press goes over the next 50
 * tournaments with no format (oldest id first) and fills the ones the stored
 * rounds and team sizes decide (POST /api/admin/formats {fillMissing}); the
 * route re-audits what it filled. A tournament it cannot decide stays null,
 * so the next press continues past it from the cursor the last answer gave.
 * The batch's outcome is the line under the button and stays until the next
 * press, since it is a result to read and not passing news.
 */
export function FillFormatsButton({ missing }: { missing: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FillResponse | null>(null);
  const [flight] = useState(singleFlight);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<FillResponse>('/api/admin/formats', {
          fillMissing: true,
          ...(result?.next ? { after: result.next } : {}),
        }),
      );
      if (!res) return;
      if (!res.ok) {
        setError(formatFailureMessage(res));
        return;
      }
      setResult(res.data);
      startTransition(() => router.refresh());
    });
  };

  return (
    <FillFormatsView
      missing={missing}
      pending={pending}
      error={error}
      result={result}
      onRun={run}
    />
  );
}

/** The count, the button, the status line and the outcome, apart from the request. */
export function FillFormatsView({
  missing,
  pending,
  error,
  result,
  onRun,
}: {
  /** Tournaments with no format, as the server counted them. */
  missing: number;
  pending: boolean;
  error: string | null;
  result: FillResponse | null;
  onRun: () => void;
}) {
  const errorId = useId();
  const statusId = useId();
  const done = result ? result.left === 0 : missing === 0;
  const label = result ? `Fill the next ${FILL_BATCH_SIZE}` : 'Fill missing formats';
  return (
    <div className="space-y-inline">
      <p className="text-body text-ink-soft">
        Tournaments with no format:{' '}
        <span className="num font-medium text-ink">{missing.toLocaleString('en-GB')}</span>
        {done && !result ? <> &mdash; Every stored tournament has a format.</> : null}
      </p>
      {done ? null : (
        <div className="flex flex-col items-start gap-hair">
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={pending}
            leftIcon={<Sparkle className="h-4 w-4" aria-hidden />}
            aria-describedby={error ? errorId : pending ? statusId : undefined}
            onClick={onRun}
          >
            {pending ? 'Filling…' : label}
          </Button>
          <p className="text-caption text-ink-soft">{FILL_BATCH_SIZE} at a time, oldest first.</p>
        </div>
      )}
      <p
        id={statusId}
        role="status"
        className="max-w-prose text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending
          ? `Reading the formats of up to ${FILL_BATCH_SIZE} tournaments. This can take up to a minute.`
          : result
            ? fillSummary(result)
            : null}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="max-w-prose text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
