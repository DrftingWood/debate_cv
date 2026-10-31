'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usePageFlight } from '@/components/admin/pageFlight';
import { useToast } from '@/components/ui/Toast';
import { retryFailureMessage } from '@/lib/admin/actionMessage';
import { retryBatches } from '@/lib/admin/importRetry';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

type RetryResponse = { requeued: number; skippedLocked: number };
export type RetryWhich = 'selected' | 'all';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Retry selected" and "Retry all n" for the Imports table: the jobs go back
 * on the queue through the retry route, in batches of the route's limit, one
 * request after another. Requeueing is not destructive (the worker just tries
 * the address again), so neither asks to confirm. It runs through the page's
 * shared flight (pageFlight.ts), so it never overlaps Fix, Mark checked or
 * Review later; the status line says which batch is running (UX-19), a
 * success is a toast and a refusal stays on screen as an alert (UX-20).
 */
export function useRetryImports(clear: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState<RetryWhich | null>(null);
  const [pending, startTransition] = useTransition();
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const run = (which: RetryWhich, ids: readonly string[]) => {
    if (pending || flight.busy) return;
    // Validated on press, not by disabling the button (UX-16): a disabled
    // button cannot say why it will not work.
    if (ids.length === 0) {
      setError('Tick at least one import to retry.');
      return;
    }
    setError(null);
    setRunning(which);
    startTransition(async () => {
      const batches = retryBatches(ids);
      const outcome = await flight.run(async () => {
        let requeued = 0;
        let skippedLocked = 0;
        for (const [i, batch] of batches.entries()) {
          setMessage(`Queuing batch ${i + 1} of ${batches.length}…`);
          const result = await postJson<RetryResponse>('/api/admin/jobs/retry', { ids: batch });
          if (!result.ok) return { failure: retryFailureMessage(result), requeued, skippedLocked };
          requeued += result.data.requeued;
          skippedLocked += result.data.skippedLocked;
        }
        return { failure: null, requeued, skippedLocked };
      });
      setMessage('');
      if (!outcome) return;
      if (outcome.failure) setError(outcome.failure);
      if (outcome.requeued > 0 || !outcome.failure) {
        toast.show({
          kind: 'success',
          title: `${plural(outcome.requeued, 'import')} queued again`,
          description: outcome.skippedLocked
            ? `${plural(outcome.skippedLocked, 'locked URL was', 'locked URLs were')} left alone.`
            : 'They run with the next queue drain.',
        });
        clear();
      }
      // Its own transition, so the buttons stay busy until the refreshed
      // list lands instead of offering the requeued rows again for a beat.
      startTransition(() => router.refresh());
    });
  };

  return {
    run,
    error,
    message,
    busy: (which: RetryWhich) => pending && running === which,
    /** The other button while one runs: focusable, announced as unavailable. */
    blocked: (which: RetryWhich) => pending && running !== which,
  };
}
