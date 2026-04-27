'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

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
}: {
  tournamentId: string;
  tournamentName: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const router = useRouter();
  const toast = useToast();
  const [isClaiming, startClaim] = useTransition();

  // Debounced fetch — only triggers when the query has at least
  // MIN_QUERY_LENGTH characters. Older requests are ignored via `seq` so a
  // fast-typing user doesn't see flicker from out-of-order responses.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
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
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data: SearchResponse = await res.json();
        if (my !== seq.current) return; // stale
        setResults(data.results);
        setHasSearched(true);
        setError(null);
      } catch (e) {
        if (my !== seq.current) return;
        setError(e instanceof Error ? e.message : 'Search failed');
        setHasSearched(true);
      } finally {
        if (my === seq.current) setIsLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, tournamentId]);

  const claim = (hit: SearchHit) => {
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
            case 'unauthorized':
              return `Your session expired. Sign in and try again.`;
            default:
              return result.error;
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

  const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;

  return (
    <div className="space-y-2.5">
      <label className="block">
        <span className="sr-only">Search participants</span>
        <span className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type your name to find yourself in this tournament…"
            className="w-full rounded-md border border-border bg-bg py-2 pl-9 pr-3 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </span>
      </label>

      {tooShort ? (
        <p className="text-caption text-muted-foreground">
          Type at least {MIN_QUERY_LENGTH} characters.
        </p>
      ) : isLoading ? (
        <p className="text-caption text-muted-foreground">Searching…</p>
      ) : error ? (
        <p className="text-caption text-destructive">{error}</p>
      ) : hasSearched && results.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          No participants found with that name.
        </p>
      ) : results.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {results.map((hit) => (
            <li
              key={hit.personId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-foreground">{hit.displayName}</span>
                <span className="ml-2 text-caption text-muted-foreground">
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
                variant={hit.isMine ? 'outline' : 'primary'}
                disabled={hit.isMine || isClaiming}
                loading={isClaiming}
                leftIcon={!isClaiming ? <UserCheck className="h-3.5 w-3.5" aria-hidden /> : undefined}
                onClick={() => claim(hit)}
              >
                {hit.isMine ? 'Already mine' : isClaiming ? 'Claiming…' : 'This is me'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
