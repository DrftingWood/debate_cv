import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

const TABS = [
  { key: 'record', label: 'Record', href: '/cv' },
  { key: 'stats', label: 'Statistics', href: '/cv/stats' },
  { key: 'motions', label: 'Motions', href: '/cv/motions' },
  { key: 'tags', label: 'Tags', href: '/cv/tags' },
  { key: 'verify', label: 'Verify', href: '/cv/verify' },
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
 */
export function CvSubNav({ active }: { active: CvTab }) {
  return (
    <nav
      aria-label="CV sections"
      data-print-hide="true"
      className="-mx-4 min-w-0 max-w-full overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <div className="inline-flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-table font-medium transition-colors',
              tab.key === active
                ? 'bg-card text-ink shadow-xs'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
