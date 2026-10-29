import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from '@/components/ui/icons';
import { auth } from '@/lib/auth';
import { buttonClasses } from '@/components/ui/Button';
import { Footer } from '@/components/Footer';
import { pageTitle } from '@/lib/utils/pageTitle';

export const metadata: Metadata = { title: pageTitle('Page not found') };

export default async function NotFound() {
  // A signed-in visitor's way forward is their record; a signed-out one's is
  // the sample. Both land somewhere that works (UX-84).
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);
  return (
    // Next renders the root not-found inside the root layout only, outside
    // every route layout, so it brings its own <main> (UX-1).
    <>
      <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 py-20 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-soft">
          <Compass weight="light" className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="mt-5 font-display text-h2 font-medium tracking-tight text-ink">
          Page not found
        </h1>
        <p className="mt-2 text-ui text-ink-soft">
          The page you're looking for doesn't exist or has moved.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href={signedIn ? '/cv' : '/sample'}
            className={buttonClasses({ variant: 'primary' })}
          >
            {signedIn ? 'Open your record' : 'See a sample CV'}
          </Link>
          <Link href="/" className={buttonClasses({ variant: 'outline' })}>
            Back to home
          </Link>
        </div>
      </main>
      <Footer width="public" />
    </>
  );
}
