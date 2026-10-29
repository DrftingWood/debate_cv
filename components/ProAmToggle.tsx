'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';
import { userMessage } from '@/lib/ingest/userMessage';
import { cn } from '@/lib/utils/cn';

/**
 * One pro-am mark on the Partners tab: a toggle button (`aria-pressed`,
 * redesign owner decision 17) named for the partner and the tournament, so
 * a screen reader hears which pairing it marks. Optimistic: the press shows
 * at once and reverts with a toast if the save fails. The visible text
 * changes with the state as well as the fill, so the state is never colour
 * alone (UX-47).
 */
export function ProAmToggle({
  tournamentId,
  tournamentName,
  partner,
  initial,
}: {
  tournamentId: string;
  tournamentName: string;
  partner: string;
  initial: boolean;
}) {
  const [marked, setMarked] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const toggle = () => {
    const next = !marked;
    setMarked(next);
    start(async () => {
      const res = await postJson('/api/cv/pro-am', { tournamentId, partner, marked: next });
      if (!res.ok) {
        setMarked(!next);
        toast.show({
          kind: 'error',
          title: 'Pro-am mark not saved',
          description: userMessage(res).description,
        });
        return;
      }
      // The year overview above counts the marks; refresh it.
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      aria-pressed={marked}
      aria-label={`Pro-am with ${partner} at ${tournamentName}`}
      onClick={toggle}
      disabled={pending}
      className={cn(
        'inline-flex h-7 items-center whitespace-nowrap rounded-md border px-inline text-caption font-medium transition-colors duration-120 motion-reduce:transition-none coarse:min-h-11',
        marked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-surface text-ink-soft hover:text-ink',
      )}
    >
      {marked ? 'Pro-am ✓' : 'Mark pro-am'}
    </button>
  );
}
