'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/utils/api';

export function ClaimPersonButton({
  personId,
  label = 'This is me',
}: {
  personId: string;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await postJson(`/api/persons/${personId}/claim`);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
        className="rounded-md bg-accent px-3 py-1 text-xs text-white font-medium hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? 'Claiming…' : label}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

export function UnclaimPersonButton({ personId }: { personId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await fetch(`/api/persons/${personId}/claim`, { method: 'DELETE' });
          router.refresh();
        });
      }}
      className="text-xs text-gray-500 underline hover:text-ink disabled:opacity-50"
    >
      {isPending ? 'Unclaiming…' : 'Unclaim'}
    </button>
  );
}
