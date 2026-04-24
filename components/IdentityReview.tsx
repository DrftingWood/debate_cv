'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/utils/api';

export type ReviewItem = {
  personId: string;
  displayName: string;
  tournaments: { id: string; name: string; year: number | null; host: string | null }[];
};

export function IdentityReview({
  items,
  hasExistingClaims,
}: {
  items: ReviewItem[];
  hasExistingClaims: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-amber-900">
          {hasExistingClaims ? 'Confirm your aliases' : 'Confirm your identity'}
        </h2>
        <span className="text-xs text-amber-700">
          {items.length} {items.length === 1 ? 'name' : 'names'} to review
        </span>
      </header>
      <p className="mt-1 text-sm text-amber-900">
        {hasExistingClaims
          ? 'These names showed up on your private URLs but you haven\'t claimed them yet. Mark each as an alias of you, or "Not me" so we don\'t ask again.'
          : 'A private URL was sent to your inbox addressed to the person below. Confirm whether that\'s you so we can build your CV.'}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <ReviewCard key={item.personId} item={item} hasExistingClaims={hasExistingClaims} />
        ))}
      </ul>
    </section>
  );
}

function ReviewCard({
  item,
  hasExistingClaims,
}: {
  item: ReviewItem;
  hasExistingClaims: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tournamentSummary =
    item.tournaments.length === 0
      ? null
      : item.tournaments
          .slice(0, 3)
          .map((t) => `${t.name}${t.year ? ` ${t.year}` : ''}`)
          .join(' · ') +
        (item.tournaments.length > 3 ? ` · +${item.tournaments.length - 3} more` : '');

  const claimLabel = hasExistingClaims ? 'Yes — alias of me' : 'Yes — this is me';

  return (
    <li className="rounded-md border border-amber-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium text-ink">{item.displayName}</div>
          {tournamentSummary ? (
            <div className="text-xs text-gray-600">{tournamentSummary}</div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await postJson(`/api/persons/${item.personId}/claim`);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              });
            }}
            className="rounded-md bg-accent px-3 py-1 text-xs text-white font-medium hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : claimLabel}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await postJson(`/api/persons/${item.personId}/reject`);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              });
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Not me
          </button>
        </div>
      </div>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </li>
  );
}
