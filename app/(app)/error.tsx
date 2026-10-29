'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { WarningCircle } from '@/components/ui/icons';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ErrorReference } from '@/components/ui/ErrorReference';

/**
 * Error boundary scoped to the (app) route group. Renders INSIDE
 * app/(app)/layout.tsx so the header chrome stays visible — the user
 * can navigate to another surface or Sign out via the header UserMenu
 * even when one page errored.
 *
 * Without this file, all (app)/* throws bubble to the root
 * app/error.tsx, which is a full-page client component with no
 * header. That made a single broken page (e.g. settings/account
 * crashing on a prisma error) feel like the whole app was dead, with
 * no way to log out.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/(app)/error]', error);
  }, [error]);

  return (
    <section className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--destructive)/0.10)] text-destructive">
        <WarningCircle weight="light" className="h-5 w-5" aria-hidden />
      </div>
      <h1 className="mt-4 font-display text-h3 font-medium text-ink">
        Something broke on this page
      </h1>
      {/* Fixed copy, never error.message (UX-26): in production a server
          error's message is already replaced by Next, but a client throw
          arrives verbatim ("Cannot read properties of undefined"). The
          digest is what a user can quote and what Sentry is keyed on. */}
      <p className="mt-2 text-table text-ink-soft">
        This page did not load. Try again, or go to your record.
      </p>
      <ErrorReference digest={error.digest} />
      <div className="mt-6 flex justify-center gap-3">
        <Button variant="primary" size="sm" onClick={() => reset()}>
          Try again
        </Button>
        <Link href="/cv" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          Go to my record
        </Link>
      </div>
    </section>
  );
}
