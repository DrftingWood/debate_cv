'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkle } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { formatFailureMessage } from '@/lib/admin/actionMessage';
import { CORE_BATCH_SIZE, coreFillSummary, type CoreFillResponse } from '@/lib/admin/coreFillText';
import { postJson } from '@/lib/utils/api';
import { usePageFlight } from '@/components/admin/pageFlight';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * Tools: "Fill missing adjudication cores". Each press reads the home page
 * (and the participants list, when never read) of the next 20 tournaments
 * that name no core (POST /api/admin/cores {fillMissing}); the route re-audits
 * what it read. It fetches, so the batch is small and runs under the page
 * flight: nothing else on the page starts while it does. A tournament whose
 * page names nobody leaves the pool, so the next press continues past it from
 * the cursor the last answer gave. The outcome is the line under the button
 * and stays until the next press, since it is a result to read and not
 * passing news.
 */
export function FillCoresButton({ missing }: { missing: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CoreFillResponse | null>(null);
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<CoreFillResponse>('/api/admin/cores', {
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
    <FillCoresView missing={missing} pending={pending} error={error} result={result} onRun={run} />
  );
}

/** The count, the button, the status line and the outcome, apart from the request. */
export function FillCoresView({
  missing,
  pending,
  error,
  result,
  onRun,
}: {
  /** Tournaments waiting for a read, as the server counted them. */
  missing: number;
  pending: boolean;
  error: string | null;
  result: CoreFillResponse | null;
  onRun: () => void;
}) {
  const errorId = useId();
  const statusId = useId();
  const done = result ? result.left === 0 : missing === 0;
  const label = result ? `Fill the next ${CORE_BATCH_SIZE}` : 'Fill missing adjudication cores';
  return (
    <div className="space-y-inline">
      <p className="text-body text-ink-soft">
        Tournaments waiting for a read:{' '}
        <span className="num font-medium text-ink">{missing.toLocaleString('en-GB')}</span>
        {done && !result ? <> &mdash; Every tournament&rsquo;s home page has been read.</> : null}
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
            {pending ? 'Reading…' : label}
          </Button>
          <p className="text-caption text-ink-soft">{CORE_BATCH_SIZE} at a time, oldest first.</p>
        </div>
      )}
      <p
        id={statusId}
        role="status"
        className="max-w-prose text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending
          ? `Reading the home pages of up to ${CORE_BATCH_SIZE} tournaments. This can take up to a minute.`
          : result
            ? coreFillSummary(result)
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
