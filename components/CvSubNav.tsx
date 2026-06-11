import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

const TABS = [
  { key: 'record', label: 'Record', href: '/cv' },
  { key: 'analytics', label: 'Analytics', href: '/cv/analytics' },
  { key: 'tags', label: 'Tags', href: '/cv/tags' },
  { key: 'verify', label: 'Verify', href: '/cv/verify' },
] as const;

export type CvTab = (typeof TABS)[number]['key'];

/**
 * Persistent sub-navigation for the CV section. Replaces the old "More"
 * dropdown (which hid Analytics and Verify) and the footnote-only path to
 * Tags — all four surfaces are now one glance and one click away from each
 * other, and the per-page "← Back" buttons go away. Server component: the
 * active tab is passed by each page rather than derived from the URL, so
 * the bar renders with zero client JS and prints nothing (print styles key
 * off data-print-hide).
 */
export function CvSubNav({ active }: { active: CvTab }) {
  return (
    <nav
      aria-label="CV sections"
      data-print-hide="true"
      className="flex items-center gap-6 border-b border-ink/15"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 pb-2 text-byline font-semibold uppercase tracking-[0.14em] transition-colors',
            tab.key === active
              ? 'border-oxblood text-ink'
              : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
