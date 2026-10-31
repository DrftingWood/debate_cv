'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { tabMoveFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/** "Remove" on one moved tab (POST /api/admin/tab-moves/[id]/remove): the old address is read as it is again. */
export function RemoveTabMoveButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flight] = useState(singleFlight);

  const run = () => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<{ removed: boolean }>(`/api/admin/tab-moves/${id}/remove`, {}),
      );
      if (!res) return;
      if (!res.ok) {
        setError(tabMoveFailureMessage(res));
        return;
      }
      toast.show({ kind: 'success', title: label, description: 'Move removed.' });
      startTransition(() => router.refresh());
    });
  };

  return (
    <div className="space-y-hair">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        aria-label={`Remove move: ${label}`}
        aria-describedby={error ? errorId : undefined}
        onClick={run}
      >
        Remove
      </Button>
      {error ? (
        <p id={errorId} role="alert" className="max-w-prose text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
