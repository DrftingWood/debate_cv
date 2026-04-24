'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
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
    <section className="rounded-lg border border-primary-100 bg-primary-50/60 p-4 md:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-primary-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bg text-primary-700">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </span>
          <h2 className="text-base font-semibold">
            {hasExistingClaims ? 'Confirm your aliases' : 'Confirm your identity'}
          </h2>
        </div>
        <span className="text-xs text-primary-700">
          {items.length} {items.length === 1 ? 'name' : 'names'} to review
        </span>
      </header>
      <p className="mt-2 text-sm text-ink-2">
        {hasExistingClaims
          ? 'These names showed up on your private URLs but you haven\'t claimed them yet. Mark each as an alias of you, or "Not me" so we don\'t ask again.'
          : 'A private URL was sent to your inbox addressed to the person below. Confirm whether that\'s you so we can build your CV.'}
      </p>
      <ul className="mt-4 space-y-2">
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
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

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
    <li className="rounded-md border border-primary-100 bg-bg p-3 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink-1">{item.displayName}</div>
          {tournamentSummary ? (
            <div className="truncate text-xs text-ink-3">{tournamentSummary}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            loading={isPending}
            leftIcon={!isPending ? <UserCheck className="h-3.5 w-3.5" aria-hidden /> : undefined}
            onClick={() => {
              startTransition(async () => {
                const result = await postJson(`/api/persons/${item.personId}/claim`);
                if (!result.ok) {
                  toast.show({ kind: 'error', title: 'Claim failed', description: result.error });
                  return;
                }
                toast.show({ kind: 'success', title: 'Claimed', description: item.displayName });
                router.refresh();
              });
            }}
          >
            {claimLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={isPending}
            leftIcon={!isPending ? <UserX className="h-3.5 w-3.5" aria-hidden /> : undefined}
            onClick={() => {
              startTransition(async () => {
                const result = await postJson(`/api/persons/${item.personId}/reject`);
                if (!result.ok) {
                  toast.show({ kind: 'error', title: 'Reject failed', description: result.error });
                  return;
                }
                toast.show({ kind: 'info', title: 'Dismissed', description: item.displayName });
                router.refresh();
              });
            }}
          >
            Not me
          </Button>
        </div>
      </div>
    </li>
  );
}
