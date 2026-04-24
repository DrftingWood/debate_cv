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
    <section className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-ink-1">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-3">
        {error.message || 'An unexpected error occurred. Try again, or head back to the dashboard.'}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button variant="primary" onClick={() => reset()}>Try again</Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/')}>Go home</Button>
      </div>
    </section>
  );
}
