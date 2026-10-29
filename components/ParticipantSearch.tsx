'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlass, UserCheck } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';
import { messageFromThrown, userMessage } from '@/lib/ingest/userMessage';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 200;

type SearchHit = {
  personId: string;
  displayName: string;
  teamName: string | null;
  role: string;
  isMine: boolean;
  score: number;
};

type SearchResponse = { results: SearchHit[]; reason?: string };

export function ParticipantSearch({
  tournamentId,
  tournamentName,
  autoFocus = false,
}: {
  tournamentId: string;
  tournamentName: string;
  /** Set when the search opens on demand (the dashboard's "Find me"). */
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const router = useRouter();
  const toast = useToast();
  const [isClaiming, startClaim] = useTransition();
  // Which hit is in flight, so only that row shows the pending state (NV-16).
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // Debounced fetch — only triggers when the query has at least
  // MIN_QUERY_LENGTH characters. Older requests are ignored via `seq` so a
  // fast-typing user doesn't see flicker from out-of-order responses.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- debounced search keyed on the query; the reset when it is too short has to run with it
      setResults([]);
      setHasSearched(false);
      setError(null);
      return;
    }
    const my = ++seq.current;
    setIsLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tournaments/${encodeURIComponent(tournamentId)}/participants?q=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body.error === 'string' && body.error ? body.error : `HTTP ${res.status}`,
          );
        }
        const data: SearchResponse = await res.json();
        if (my !== seq.current) return; // stale
        setResults(data.results);
        setHasSearched(true);
        setError(null);
      } catch (e) {
        if (my !== seq.current) return;
        setError(`Search did not work. ${messageFromThrown(e).description}`);
        setHasSearched(true);
      } finally {
        if (my === seq.current) setIsLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, tournamentId]);

  const claim = (hit: SearchHit) => {
    setClaimingId(String(hit.personId));
    startClaim(async () => {
      const result = await postJson(`/api/persons/${hit.personId}/claim`);
      if (!result.ok) {
        // Translate API error codes into actionable messages. The most common
        // race here is `already_claimed_by_other` — User B's search returned
        // a Person that User A claimed mid-click. Refresh the page so the
        // stale row disappears and the user can try again.
        const description = (() => {
          switch (result.error) {
            case 'already_claimed_by_other':
              return `${hit.displayName} was just claimed by another user. Search again to see updated results.`;
            case 'forbidden':
              return `You can only claim a person on a tournament you've ingested.`;
            default:
              return userMessage(result).description;
          }
        })();
        toast.show({ kind: 'error', title: 'Claim failed', description });
        // Drop the stale hit locally and pull fresh data — covers both the
        // claimed-by-other case and any other server-side state drift.
        setResults((prev) => prev.filter((h) => h.personId !== hit.personId));
        router.refresh();
        return;
      }
      toast.show({
        kind: 'success',
        title: 'Claimed',
        description: `${hit.displayName} (${tournamentName})`,
      });
      router.refresh();
    });
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;

  return (
    <div className="space-y-2.5">
      {/*
        A visible label, not a placeholder: the placeholder vanished on the
        first keystroke and took the instruction with it. `border-input`
        rather than the hairline `border-border` (a field edge must reach 3:1,
        SC 1.4.11), and no `outline-hidden`: the global :focus-visible outline
        is the visible focus, where the old 30% ring was close to invisible.
      */}
      <label htmlFor={inputId} className="block text-caption font-medium text-ink">
        Search the participant list for {tournamentName}
      </label>
      <span className="relative block">
        <MagnifyingGlass
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft"
          aria-hidden
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Your name as it appears on the tab"
          className="w-full rounded-md border border-input bg-paper py-2 pl-9 pr-3 text-base text-ink md:text-ui placeholder:text-ink-soft focus:border-primary"
        />
      </span>

      {/*
        The status line is a live region. Results, "Searching…", the empty
        result and the error all arrived silently before — and this is the
        identity-claim flow, where picking the wrong row takes a record that
        is not yours. `role="alert"` for the error so a failure interrupts;
        polite for everything else so typing is not narrated over. The
        two regions are siblings (nested live regions double-announce).
      */}
      <div role="status">
        {tooShort ? (
          <p className="text-caption text-ink-soft">Type at least {MIN_QUERY_LENGTH} characters.</p>
        ) : isLoading ? (
          <p className="text-caption text-ink-soft">Searching…</p>
        ) : error ? null : hasSearched && results.length === 0 ? (
          <p className="text-caption text-ink-soft">No participants found with that name.</p>
        ) : results.length > 0 ? (
          <p className="sr-only">
            {results.length} participant{results.length === 1 ? '' : 's'} found.
          </p>
        ) : null}
      </div>
      {/* A sibling, never inside the polite region: nested live regions are read twice or not at all. */}
      <div role="alert">
        {error && !tooShort && !isLoading ? (
          <p className="text-caption text-destructive">{error}</p>
        ) : null}
      </div>

      {tooShort || isLoading || error ? null : results.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {results.map((hit) => (
            <li
              key={hit.personId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-ink">{hit.displayName}</span>
                <span className="ml-2 text-caption text-ink-soft">
                  {hit.role}
                  {hit.teamName ? ` · ${hit.teamName}` : ''}
                </span>
                {hit.isMine ? (
                  <Badge variant="success" className="ml-2">
                    Mine
                  </Badge>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={hit.isMine || isClaiming}
                loading={isClaiming && claimingId === String(hit.personId)}
                aria-label={
                  hit.isMine ? `Already mine: ${hit.displayName}` : `This is me: ${hit.displayName}`
                }
                leftIcon={
                  !(isClaiming && claimingId === String(hit.personId)) ? (
                    <UserCheck className="h-3.5 w-3.5" aria-hidden />
                  ) : undefined
                }
                onClick={() => claim(hit)}
              >
                {hit.isMine ? 'Already mine' : 'This is me'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
