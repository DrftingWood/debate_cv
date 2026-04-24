'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ClaimPersonButton({ personId }: { personId: string }) {
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
            try {
              const res = await fetch(`/api/persons/${personId}/claim`, { method: 'POST' });
              if (!res.ok) throw new Error((await res.json()).error ?? `status ${res.status}`);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Claim failed');
            }
          });
        }}
        className="rounded-md bg-accent px-3 py-1 text-xs text-white font-medium hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? 'Claiming…' : 'This is me'}
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
