'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/Button';

/**
 * A submit button for a server-action form that shows it is working.
 *
 * The landing page's sign-in forms hand off to Google through a server
 * action, which takes a moment; with no pending state a second tap started
 * OAuth twice and nothing on screen said anything had happened (FORM-13).
 * `useFormStatus` must sit inside the form, so this is a client leaf.
 * `loading` also disables the button, which blocks the second submit.
 */
export function PendingSubmit(props: Omit<ButtonProps, 'type' | 'loading'>) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" loading={pending} />;
}

/** The plain-text "Sign in" in the masthead, with the same pending guard. */
export function PendingTextSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="rounded-md px-2 py-2 font-medium text-ink hover:text-primary disabled:opacity-60"
    >
      {pending ? 'Signing in…' : children}
    </button>
  );
}
