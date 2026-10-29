'use client';

import { useFormStatus } from 'react-dom';
import { ArrowCounterClockwise } from '@/components/ui/icons';
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
  return (
    <form
      action={async () => {
        const { reconnectGmail } = await import('@/lib/auth/reconnectGmail');
        await reconnectGmail(redirectTo);
      }}
    >
      <SubmitButton size={size} variant={variant} label={label} />
    </form>
  );
}

/**
 * `useFormStatus` is pending from the moment the form is submitted, which
 * covers the dynamic import as well as the server action. The previous
 * `useTransition` only started after the import resolved, so a second tap in
 * that gap began a second OAuth round trip (FORM-13).
 */
function SubmitButton({
  size,
  variant,
  label,
}: {
  size: 'sm' | 'md';
  variant: 'primary' | 'secondary';
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size={size}
      variant={variant}
      leftIcon={<ArrowCounterClockwise className="h-4 w-4" aria-hidden />}
      loading={pending}
    >
      {label}
    </Button>
  );
}
