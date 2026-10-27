'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ErrorReference } from '@/components/ui/ErrorReference';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    // Rendered in place of a top-level page (landing, sample, public CV),
    // none of which has a <main> of its own once this replaces it (UX-1).
    <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 py-20 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--destructive)/0.10)] text-destructive">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-5 font-display text-h2 font-medium tracking-tight text-ink">
        Something went wrong
      </h1>
      {/* Fixed copy, never error.message (UX-26); see app/(app)/error.tsx. */}
      <p className="mt-2 text-ui text-ink-soft">
        This page did not load. Try again, or go back to the home page.
      </p>
      <ErrorReference digest={error.digest} />
      <div className="mt-7 flex justify-center gap-3">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link href="/" className={buttonClasses({ variant: 'secondary' })}>
          Go home
        </Link>
      </div>
    </main>
  );
}
