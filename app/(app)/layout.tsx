import Link from 'next/link';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { NavLink } from '@/components/NavLink';
import { BrandMark } from '@/components/BrandMark';
import { Footer } from '@/components/Footer';
import { NotificationBell } from '@/components/NotificationBell';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/UserMenu';

/**
 * (app) route group layout — applies to the entire signed-in app surface:
 * /cv, /dashboard, /settings, /onboarding, /admin, /privacy, /terms.
 * Holds the sticky header (BrandMark + nav + notifications) and the global
 * footer.
 *
 * Landing (app/page.tsx) and the public CV (app/u/[slug]) deliberately
 * live OUTSIDE this group so they don't inherit any app chrome — they read
 * as standalone documents.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Logo target depends on auth: signed-in users go to their CV (the
  // primary in-app surface), signed-out users land on the marketing home.
  const session = await auth();
  const logoHref = session?.user?.id ? '/cv' : '/';
  // Discoverability only — /admin still enforces requireAdmin server-side.
  // Without this link, admins had no in-app path to the panel at all.
  const showAdmin = isAdminEmail(session?.user?.email);
  const signedIn = Boolean(session?.user?.id);

  return (
    <>
      {/*
        Sticky only from md up.

        On a phone the header is two stacked rows — brand/account, then the
        section strip — and pinning both cost 118px, 21% of a 390x844
        viewport and 30% in landscape, permanently, on every page. A record
        page is something you scroll and read; giving a fifth of the screen
        to chrome that repeats what the page already says is the wrong
        trade. The strip scrolls away with the page and comes back with an
        upward flick, which is the platform-native behaviour anyway.
        `top-[env(safe-area-inset-top)]` keeps the pinned desktop header
        clear of a notch when the browser is in landscape.
      */}
      <header className="z-40 border-b border-border bg-background/90 backdrop-blur-md md:sticky md:top-0">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-5 py-3">
          <Link href={logoHref} className="inline-flex shrink-0 items-center">
            <BrandMark />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            {/* Named like the mobile strip; only one of the two is ever
                visible, so they never read as two "Sections" at once. */}
            <nav
              aria-label="Sections"
              className="hidden items-center gap-0.5 text-table font-medium md:flex"
            >
              <SectionLinks signedIn={signedIn} showAdmin={showAdmin} />
            </nav>
            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              {signedIn && session?.user ? (
                <>
                  <NotificationBell />
                  <UserMenu
                    name={session.user.name ?? null}
                    email={session.user.email ?? null}
                    image={session.user.image ?? null}
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
        {/* Below md the nav moves to its own scrollable strip rather than
            collapsing into a hamburger: five destinations fit, and a menu
            that hides the record behind a tap is the wrong trade here. */}
        {/*
          `snap-x` plus the edge fade: the strip is 415px of destinations in
          a 390px viewport, so the last item sat off-screen with nothing to
          say it was there. The mask makes the cut edge visibly a cut edge
          rather than the end of the list.
        */}
        <nav
          aria-label="Sections"
          className="flex snap-x items-center gap-0.5 overflow-x-auto border-t border-border px-5 py-1 text-table font-medium [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] md:hidden md:[mask-image:none]"
        >
          <SectionLinks signedIn={signedIn} showAdmin={showAdmin} />
        </nav>
      </header>
      {/* The one <main>, a sibling of the header and footer rather than
          their parent (UX-1; see app/layout.tsx). flex-1 keeps the footer at
          the bottom of a short page. */}
      <main id="main" className="mx-auto w-full max-w-screen-2xl flex-1 px-5 py-8">
        {children}
      </main>
      <Footer />
    </>
  );
}

/**
 * Signed in: the four task destinations. Task names, not object names:
 * "Record" is what the page is for, "Imports" is what the dashboard
 * actually does.
 *
 * Signed out, a visitor only reaches this layout through /privacy and
 * /terms, and every one of those four links bounced them to `/`. They get
 * what they can actually open instead (DESIGN_INSTRUCTIONS §5: do not lead
 * signed-out users into app furniture they cannot use).
 */
function SectionLinks({ signedIn, showAdmin }: { signedIn: boolean; showAdmin: boolean }) {
  if (!signedIn) {
    return (
      <>
        <NavLink href="/sample">Sample CV</NavLink>
        <NavLink href="/privacy">Privacy</NavLink>
        <NavLink href="/">Build my CV</NavLink>
      </>
    );
  }
  return (
    <>
      <NavLink href="/cv" exact>
        Record
      </NavLink>
      <NavLink href="/cv/stats">Statistics</NavLink>
      <NavLink href="/dashboard">Imports</NavLink>
      <NavLink href="/settings">Settings</NavLink>
      {showAdmin ? <NavLink href="/admin">Admin</NavLink> : null}
    </>
  );
}
