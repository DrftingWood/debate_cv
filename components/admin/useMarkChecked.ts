'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { markFailureMessage } from '@/lib/admin/actionMessage';
import { markedWords, undoOutcome, undoTargets } from '@/lib/admin/inboxActions';
import type { InboxMarkItem } from '@/lib/admin/inboxTypes';
import type { MarkTarget } from '@/lib/admin/inboxActions';
import { deleteJson, postJson } from '@/lib/utils/api';
import { usePageFlight } from '@/components/admin/pageFlight';
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
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const { undo, undoing } = useUndo(flight, pending, startTransition);

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
    undo,
    error,
    setError,
    undoing,
    busy: (id: string) => pending && running === id,
    blocked: (id: string) => pending && running !== id,
  };
}

/**
 * Undo for a mark: takes the marks back one by one (the route takes one
 * target per DELETE). Every mark is tried, so one failure does not strand
 * the rest half-undone without saying so, and the page refreshes whatever
 * happened so the rows show what is really checked. It shares the mark's
 * single flight: the Undo button is in a toast that is gone once pressed, so
 * a refusal while something else runs is said in a new toast.
 */
function useUndo(
  flight: ReturnType<typeof singleFlight>,
  pending: boolean,
  startTransition: (fn: () => Promise<void> | void) => void,
) {
  const router = useRouter();
  const toast = useToast();
  const [undoing, setUndoing] = useState('');
  const undo = (items: readonly MarkTarget[]) => {
    const targets = undoTargets(items);
    if (pending || flight.busy) {
      toast.show({
        kind: 'error',
        title: 'Undo did not run',
        description: 'Another action is still running. Reload the page to see what is checked.',
      });
      return;
    }
    startTransition(async () => {
      const outcome = await flight.run(async () => {
        let failed = 0;
        let reason: string | null = null;
        for (const [i, target] of targets.entries()) {
          setUndoing(`Undoing ${i + 1} of ${targets.length}…`);
          const result = await deleteJson('/api/admin/checks', target);
          if (!result.ok) {
            failed += 1;
            reason ??= markFailureMessage(result);
          }
        }
        return { failed, reason };
      });
      setUndoing('');
      if (outcome) toast.show(undoOutcome(targets.length, outcome.failed, outcome.reason));
      startTransition(() => router.refresh());
    });
  };
  return { undo, undoing };
}
