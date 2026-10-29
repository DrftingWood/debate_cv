import Link from 'next/link';
import { signIn } from '@/lib/auth';
import { BrandMark } from '@/components/BrandMark';
import { PendingTextSubmit } from '@/components/PendingSubmit';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * The one signed-out header, shared by `/`, `/sample`, `/privacy` and
 * `/terms` (NV-10, NV-11). These pages used to carry three different
 * headers: different items, a different order, and the theme toggle on only
 * two of the four. A visitor moving between them now sees the same bar:
 * Sample CV, Privacy, Sign in, then the theme toggle in the same slot.
 *
 * "Sign in" is the same Google flow as every "Build my CV" button, so one
 * label always means one action. Below 380px the Sample CV link drops out
 * (the landing hero and the sample page both have a full-width path to it)
 * so the row does not wrap at 320px. Below 420px Privacy drops out too (it
 * is in every footer): at 390px all three items plus the toggle were 23px
 * wider than the row and made the page scroll sideways.
 */
/**
 * `signedIn`: /sample is the one page with this header a signed-in visitor
 * can reach (the landing page redirects them, the app has its own header),
 * and it offered them "Sign in" (owner review 2026-10-29). With it, the last
 * link goes to their record instead.
 */
export function PublicHeader({ signedIn = false }: { signedIn?: boolean } = {}) {
  return (
    <header className="flex items-center justify-between gap-3 py-5 md:py-6">
      <Link href="/" aria-label="debate cv home">
        <BrandMark />
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        <nav
          aria-label="Site"
          className="flex items-center gap-3 whitespace-nowrap text-table font-medium text-ink-soft sm:gap-6"
        >
          <Link href="/sample" className="py-2 hover:text-ink max-[380px]:hidden">
            Sample CV
          </Link>
          {/* Sample · How it works · Privacy (design §3.1); the middle one
              drops first on a narrow phone, then the others. */}
          <Link href="/#how" className="py-2 hover:text-ink max-md:hidden">
            How it works
          </Link>
          <Link href="/privacy" className="py-2 hover:text-ink max-[420px]:hidden">
            Privacy
          </Link>
          {signedIn ? (
            <Link href="/cv" className="py-2 text-ink hover:text-primary">
              Your record
            </Link>
          ) : (
            <form
              action={async () => {
                'use server';
                await signIn('google', { redirectTo: '/cv' });
              }}
            >
              <PendingTextSubmit>Sign in</PendingTextSubmit>
            </form>
          )}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
