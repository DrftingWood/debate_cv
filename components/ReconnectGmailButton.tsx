'use client';

import { useTransition } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Re-grant Gmail access after a disconnect (or any state where the
 * GmailToken row is missing). Forces Google's consent screen via
 * `prompt: 'consent'` so a fresh refresh token always lands in the
 * NextAuth callback — sidesteps the case where Google would silently
 * skip consent and not re-issue a refresh token.
 *
 * Calls signIn on the client via a small server-action wrapper so we
 * don't have to import next-auth/react (this project uses NextAuth v5
 * beta which has different client/server boundaries than v4).
 */
export function ReconnectGmailButton({
  redirectTo = '/dashboard',
  size = 'md',
  variant = 'primary',
  label = 'Reconnect Gmail',
}: {
  redirectTo?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <form
      action={async () => {
        const { reconnectGmail } = await import('@/lib/auth/reconnectGmail');
        startTransition(async () => {
          await reconnectGmail(redirectTo);
        });
      }}
    >
      <Button
        type="submit"
        size={size}
        variant={variant}
        leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
        loading={isPending}
      >
        {label}
      </Button>
    </form>
  );
}
