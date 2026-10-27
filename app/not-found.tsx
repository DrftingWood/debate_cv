import Link from 'next/link';
import { Compass } from 'lucide-react';
import { buttonClasses } from '@/components/ui/Button';

export default function NotFound() {
  return (
    // Next renders the root not-found inside the root layout only, outside
    // every route layout, so it brings its own <main> (UX-1).
    <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 py-20 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-soft">
        <Compass className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-5 font-display text-h2 font-medium tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 text-ui text-ink-soft">
        The page you're looking for doesn't exist or has moved.
      </p>
      <div className="mt-7 flex justify-center">
        <Link href="/" className={buttonClasses({ variant: 'primary' })}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
