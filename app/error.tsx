'use client';

import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

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
    <section className="mx-auto max-w-lg py-20 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--destructive)/0.10)] text-destructive">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-5 font-display text-h2 font-semibold text-foreground">
        Something went wrong
      </h1>
      <p className="mt-2 text-[14px] text-muted-foreground">
        {error.message || 'An unexpected error occurred. Try again, or head back home.'}
      </p>
      <div className="mt-7 flex justify-center gap-3">
        <Button variant="primary" onClick={() => reset()}>Try again</Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/')}>
          Go home
        </Button>
      </div>
    </section>
  );
}
