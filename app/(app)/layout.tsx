import Link from 'next/link';
import { auth } from '@/lib/auth';
import { NavLink } from '@/components/NavLink';
import { BrandMark } from '@/components/BrandMark';
import { Footer } from '@/components/Footer';
import { NotificationBell } from '@/components/NotificationBell';
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

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href={logoHref} className="inline-flex items-center">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-6 text-[13.5px] font-medium">
              <NavLink href="/cv">My CV</NavLink>
              <NavLink href="/dashboard">Dashboard</NavLink>
              <NavLink href="/settings">Settings</NavLink>
            </nav>
            {session?.user?.id ? (
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
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10">{children}</div>
      <Footer />
    </>
  );
}
