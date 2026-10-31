'use client';

import { useId, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkle } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { formatFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { usePageFlight } from '@/components/admin/pageFlight';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * The shared body of the Tools tab's bounded, cursor-based bulk actions that
 * are not the format or core fills (those keep their own buttons): "Fill
 * years from names" and "Refresh old-parser tournaments". Each press posts
 * `{ [flag]: true, after? }` and gets back a batch's outcome with
 * `{ left, next }`; the cursor moves past anything the batch could not settle
 * so a press never meets it again. It runs under the page flight, so nothing
 * else on the page starts while it does, and its outcome is the status line
 * under the button, which stays until the next press: a result to read, not
 * passing news.
 */
export type BulkResult = { left: number; next: string | null };

export function useBulkFill<R extends BulkResult>(endpoint: string, flag: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<R>(endpoint, { [flag]: true, ...(result?.next ? { after: result.next } : {}) }),
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
  return { pending, error, result, run };
}

export type BulkFillWords = {
  /** "Tournaments with no year:" */
  count: string;
  /** Shown beside the count when nothing is waiting and no press has run. */
  allDone: string;
  /** The first press's button. */
  first: string;
  /** Later presses: "Fill the next 50". */
  next: string;
  /** While a press runs. */
  busy: string;
  /** "50 at a time, oldest first." */
  hint: string;
  /** The status line while a press runs. */
  working: string;
};

/** The count, the button, the status line and the outcome, apart from the request. */
export function BulkFillView<R extends BulkResult>({
  waiting,
  words,
  pending,
  error,
  result,
  summary,
  onRun,
}: {
  /** Tournaments waiting, as the server counted them. */
  waiting: number;
  words: BulkFillWords;
  pending: boolean;
  error: string | null;
  result: R | null;
  summary: (r: R) => string;
  onRun: () => void;
}): ReactNode {
  const errorId = useId();
  const statusId = useId();
  const done = result ? result.left === 0 : waiting === 0;
  return (
    <div className="space-y-inline">
      <p className="text-body text-ink-soft">
        {words.count}{' '}
        <span className="num font-medium text-ink">{waiting.toLocaleString('en-GB')}</span>
        {done && !result ? <> &mdash; {words.allDone}</> : null}
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
            {pending ? words.busy : result ? words.next : words.first}
          </Button>
          <p className="text-caption text-ink-soft">{words.hint}</p>
        </div>
      )}
      <p
        id={statusId}
        role="status"
        className="max-w-prose text-caption whitespace-normal text-ink-soft empty:hidden"
      >
        {pending ? words.working : result ? summary(result) : null}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="max-w-prose text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
