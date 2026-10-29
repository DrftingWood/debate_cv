import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from '@/components/ui/icons';
import { buttonClasses } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'This CV is not available',
  robots: { index: false, follow: false },
};

/**
 * Segment-level 404 for /u/<slug> (NV-2). The public layout already wraps
 * children in <main id="main">, so this renders content only: the root
 * not-found brings its own <main> and nested two landmarks here. The copy
 * deliberately does not say whether the slug exists or is merely unshared.
 */
export default function PublicCvNotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-soft">
        <Compass weight="light" className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-5 font-display text-h2 font-medium tracking-tight text-ink">
        This CV is not available
      </h1>
      <p className="mt-2 text-ui text-ink-soft">
        The link may be mistyped, or the owner may have stopped sharing it.
      </p>
      <div className="mt-group flex justify-center">
        <Link href="/" className={buttonClasses({ variant: 'primary' })}>
          Build your own debate CV
        </Link>
      </div>
    </div>
  );
}
