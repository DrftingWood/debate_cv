import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SettingsSideNav } from '@/components/SettingsSideNav';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Manage your identity, sharing, reports, and account.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Settings shell — gates auth and renders the sub-page next to a left-nav
 * menu. Each sub-page is its own route under app/settings/* so users can
 * deep-link to a specific section (e.g. from a help doc or a notification).
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-h1 font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-2 text-body text-muted-foreground">
          Manage your identity, sharing, reports, and account.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[200px_1fr]">
        <aside className="md:sticky md:top-20 md:self-start">
          <SettingsSideNav />
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
