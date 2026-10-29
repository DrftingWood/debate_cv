import Link from 'next/link';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { isDiscoveryEnabled } from '@/lib/discovery/flag';
import { ScrollCurrentNav } from '@/components/ScrollCurrentNav';
import { cn } from '@/lib/utils/cn';

const TABS = [
  { key: 'record', label: 'Record', href: '/cv', adminOnly: false, discovery: false },
  { key: 'stats', label: 'Statistics', href: '/cv/stats', adminOnly: false, discovery: false },
  { key: 'motions', label: 'Motions', href: '/cv/motions', adminOnly: false, discovery: false },
  // Behind the discovery flag (lib/discovery/flag.ts): a user without it
  // gets a 404 at /cv/found, so the bar must not offer the link either.
  { key: 'found', label: 'Found', href: '/cv/found', adminOnly: false, discovery: true },
  // Operator tools, not participant features: the pages redirect a
  // non-admin away, and the bar does not offer them.
  { key: 'tags', label: 'Tags', href: '/cv/tags', adminOnly: true, discovery: false },
  { key: 'verify', label: 'Verify', href: '/cv/verify', adminOnly: true, discovery: false },
] as const;

export type CvTab = (typeof TABS)[number]['key'];

/**
 * Persistent sub-navigation for the CV section. Rendered as a segmented
 * control (the account-switcher pattern from a banking dashboard) rather
 * than an underlined tab bar: it survives five items on a phone, and the
 * enclosed pill makes the current surface unambiguous at a glance.
 *
 * Server component — the active tab is passed by each page rather than
 * derived from the URL, so the bar costs zero client JS and prints nothing.
 * It reads the session itself so no page can forget to hide the admin tabs.
 */
export async function CvSubNav({ active }: { active: CvTab }) {
  const session = await auth();
  const email = session?.user?.email;
  const admin = isAdminEmail(email);
  const discovery = isDiscoveryEnabled(email);
  const tabs = TABS.filter((tab) => (admin || !tab.adminOnly) && (discovery || !tab.discovery));
  return (
    <ScrollCurrentNav
      aria-label="CV sections"
      data-print-hide="true"
      className="-mx-4 min-w-0 max-w-full overflow-x-auto px-4 mask-[linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] sm:mx-0 sm:px-0 sm:mask-none"
    >
      <div className="inline-flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center rounded-md px-3 py-1.5 text-table font-medium transition-colors coarse:min-h-[44px] coarse:py-0',
              tab.key === active
                ? 'bg-card font-semibold text-ink shadow-xs ring-1 ring-inset ring-ink/40'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </ScrollCurrentNav>
  );
}
