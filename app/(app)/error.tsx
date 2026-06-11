'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

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
        <AlertCircle className="h-5 w-5" aria-hidden />
      </div>
      <h1 className="mt-4 font-display text-h3 font-semibold text-record-ink">
        Something broke on this page.
      </h1>
      <p className="mt-2 text-table text-record-muted">
        {error.message ||
          'An unexpected error occurred. Try again, or jump to a different surface from the nav above.'}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button variant="primary" size="sm" onClick={() => reset()}>
          Try again
        </Button>
        <Link href="/cv">
          <Button variant="secondary" size="sm" type="button">
            Go to my CV
          </Button>
        </Link>
      </div>
    </section>
  );
}
