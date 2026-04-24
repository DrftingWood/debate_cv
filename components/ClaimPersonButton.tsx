'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

export function ClaimPersonButton({
  personId,
  label = 'This is me',
  size = 'sm' as const,
  variant = 'primary' as const,
}: {
  personId: string;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      loading={isPending}
      leftIcon={!isPending ? <UserCheck className="h-3.5 w-3.5" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await postJson(`/api/persons/${personId}/claim`);
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Claim failed', description: result.error });
            return;
          }
          toast.show({ kind: 'success', title: 'Claimed', description: 'Linked to your CV.' });
          router.refresh();
        });
      }}
    >
      {label}
    </Button>
  );
}

export function UnclaimPersonButton({ personId }: { personId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      loading={isPending}
      leftIcon={!isPending ? <UserX className="h-3.5 w-3.5" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          await fetch(`/api/persons/${personId}/claim`, { method: 'DELETE' });
          toast.show({ kind: 'info', title: 'Unclaimed' });
          router.refresh();
        });
      }}
    >
      Unclaim
    </Button>
  );
}
