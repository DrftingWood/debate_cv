import Link from 'next/link';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { AppNav } from '@/components/AppNav';
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

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-ink/15 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-5 py-3.5">
          <Link href={logoHref} className="inline-flex items-center">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-4">
            {/* Brief §5: name primary surfaces after the user job, not the
                implementation object. CV is the artifact, Growth is the
                value, Imports is the task, Share owns publication and
                exports, Settings is account hygiene. Active resolution is
                longest-prefix-wins so /cv vs /cv/analytics and /settings vs
                /settings/sharing pick exactly one item. */}
            <AppNav
              items={[
                { href: '/cv', label: 'CV' },
                { href: '/cv/analytics', label: 'Growth' },
                { href: '/dashboard', label: 'Imports' },
                { href: '/settings/sharing', label: 'Share' },
                { href: '/settings', label: 'Settings' },
                ...(showAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
              ]}
            />
            <ThemeToggle />
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
      <div className="mx-auto max-w-screen-2xl px-5 py-10">{children}</div>
      <Footer />
    </>
  );
}
