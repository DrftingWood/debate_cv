import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <section className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bg-muted text-ink-3">
        <Compass className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-ink-1">Page not found</h1>
      <p className="mt-2 text-sm text-ink-3">
        The page you're looking for doesn't exist or has moved.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href="/">
          <Button variant="primary">Back to home</Button>
        </Link>
      </div>
    </section>
  );
}
