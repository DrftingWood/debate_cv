'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { allowFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * "Allow ingesting again" on one deleted tab address (POST
 * /api/admin/deleted-tournaments/[id]/allow). Nothing is restored: the next
 * import or pre-scrape of the tab stores it afresh. Success is a toast; a
 * refusal stays as an alert.
 */
export function AllowAgainButton({ id, name }: { id: string; name: string }) {
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
        postJson<{ allowed: boolean }>(`/api/admin/deleted-tournaments/${id}/allow`, {}),
      );
      if (!res) return;
      if (!res.ok) {
        setError(allowFailureMessage(res));
        return;
      }
      toast.show({ kind: 'success', title: name, description: 'It can be ingested again.' });
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
        aria-label={`Allow ingesting again: ${name}`}
        aria-describedby={error ? errorId : undefined}
        onClick={run}
      >
        Allow ingesting again
      </Button>
      {error ? (
        <p id={errorId} role="alert" className="max-w-prose text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
