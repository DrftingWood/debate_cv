'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { markFailureMessage } from '@/lib/admin/actionMessage';
import { markedWords, undoTargets } from '@/lib/admin/inboxActions';
import type { InboxMarkItem } from '@/lib/admin/inboxTypes';
import { deleteJson, postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

type MarkResponse = { marked: number; applied: number };

/** One press of "Mark checked": whose marks, which rows leave, and what to call it. */
export type MarkRequest = { id: string; items: InboxMarkItem[]; keys: string[]; what: string };

/**
 * "Mark checked": stores the marks (the route re-audits, so a tournament's
 * score has already risen when it answers), says so in a toast with Undo,
 * and refreshes so the row leaves. A refusal stays on screen as an alert
 * (UX-20); one press at a time, whichever button started it (UX-17).
 */
export function useMarkChecked(onMarked: (keys: readonly string[]) => void) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  // Undo takes the marks back one by one (the route takes one target per
  // DELETE), then refreshes so the rows return.
  const undo = (items: readonly InboxMarkItem[]) => {
    startTransition(async () => {
      for (const target of undoTargets(items)) {
        const result = await deleteJson('/api/admin/checks', target);
        if (!result.ok) {
          toast.show({
            kind: 'error',
            title: 'Undo failed',
            description: markFailureMessage(result),
          });
          return;
        }
      }
      toast.show({
        kind: 'success',
        title: 'Mark undone',
        description: 'It is back in the Inbox.',
      });
      startTransition(() => router.refresh());
    });
  };

  const mark = ({ id, items, keys, what }: MarkRequest) => {
    if (pending || flight.busy) return;
    setError(null);
    setRunning(id);
    startTransition(async () => {
      const result = await flight.run(() => postJson<MarkResponse>('/api/admin/checks', { items }));
      if (!result) return;
      if (!result.ok) {
        setError(markFailureMessage(result));
        return;
      }
      const checks = items.filter((i) => i.kind === 'check').length;
      toast.show({
        kind: 'success',
        title: 'Marked checked',
        description: `${what}. ${markedWords(checks, result.data.applied)}`,
        action: { label: 'Undo', onClick: () => undo(items) },
      });
      onMarked(keys);
      startTransition(() => router.refresh());
    });
  };

  return {
    mark,
    error,
    setError,
    busy: (id: string) => pending && running === id,
    blocked: (id: string) => pending && running !== id,
  };
}
