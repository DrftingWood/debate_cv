'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlass } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { FieldError, fieldInputClass } from '@/components/FieldError';
import { cn } from '@/lib/utils/cn';
import { LookupResultView, type LookupView } from '@/components/admin/LookupResult';
import { asLookupUrl } from '@/lib/admin/tabAddress';
import { lookupFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/** The route's own limit, checked here first so the answer is immediate. */
const MAX_CHARS = 500;

/**
 * "Is this tournament in the database?": one search box for /admin and
 * /admin/tournaments, so there is one implementation (owner, 2026-10-31).
 *
 * A name goes to /admin?tab=tournaments&q=, the paged list of matches. A URL is
 * looked up in place through POST /api/admin/lookup and answered in the
 * live region under the box: a pasted private URL then travels in a request
 * body, never in an address bar, a history entry or a server log, and the
 * answer carries no key back. Without JavaScript (or on an Enter before
 * hydration) the form POSTs to api/admin/lookup/search, which answers 303
 * to the list page with the text's public form, so the key stays out of
 * addresses and request logs there too.
 *
 * Checked on press, not by disabling the button (UX-16): an empty box says
 * what to type. One lookup at a time (singleFlight, UX-17).
 */
export function TournamentLookup({ defaultValue = '' }: { defaultValue?: string }) {
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(defaultValue);
  const { submit, error, answer, pending } = useLookup(value);

  return (
    <form
      action="/api/admin/lookup/search"
      method="post"
      role="search"
      noValidate
      onSubmit={submit}
      className="space-y-inline"
    >
      <label htmlFor={inputId} className="block text-ui font-medium text-ink">
        Tournament or private URL
      </label>
      <div className="flex flex-wrap items-center gap-inline">
        <input
          id={inputId}
          name="q"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(fieldInputClass, 'w-auto min-w-0 max-w-prose flex-1 sm:min-w-80')}
        />
        <Button
          type="submit"
          variant="outline"
          loading={pending}
          leftIcon={<MagnifyingGlass className="h-4 w-4" aria-hidden />}
        >
          Look up
        </Button>
      </div>
      {/* An alert, so a refusal on press is heard as well as seen (UX-16). */}
      <div role="alert">{error ? <FieldError id={errorId}>{error}</FieldError> : null}</div>
      {/* Present from the first render, so its answer is announced (UX-19). */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {pending && !answer ? <p className="text-caption text-ink-soft">Looking up…</p> : null}
        {answer ? <LookupResultView result={answer.view} now={answer.at} /> : null}
      </div>
    </form>
  );
}

/** What "Look up" does with the box's text, and what it has to show for it. */
function useLookup(value: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ view: LookupView; at: Date } | null>(null);
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || flight.busy) return;
    const q = value.trim();
    const problem = !q
      ? 'Type a tournament name or paste a tab URL.'
      : q.length > MAX_CHARS
        ? 'That is too long to be a tab URL.'
        : null;
    setError(problem);
    if (problem) return;
    // Text with a /privateurls/ segment counts as a URL even without its
    // scheme, so a key is never pushed into the address as a name search.
    const url = asLookupUrl(q);
    if (!url) {
      setAnswer(null);
      startTransition(() => router.push(`/admin?tab=tournaments&q=${encodeURIComponent(q)}`));
      return;
    }
    startTransition(async () => {
      const result = await flight.run(() => postJson<LookupView>('/api/admin/lookup', { url }));
      if (!result) return;
      if (!result.ok) {
        setAnswer(null);
        setError(lookupFailureMessage(result));
        return;
      }
      // The clock the answer's "Stored 2 h ago" is read against.
      setAnswer({ view: result.data, at: new Date() });
    });
  };

  return { submit, error, answer, pending };
}
