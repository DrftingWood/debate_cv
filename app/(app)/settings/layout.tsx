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
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[200px_1fr]">
        <aside className="md:sticky md:top-20 md:self-start">
          <div className="mb-3 space-y-1">
            <div className="eyebrow">SETTINGS</div>
            <h2 className="font-display text-h3 text-record-ink">Settings.</h2>
          </div>
          <SettingsSideNav />
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
