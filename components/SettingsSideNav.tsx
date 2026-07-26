'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const ITEMS: { href: string; label: string }[] = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/sharing', label: 'Public sharing' },
  { href: '/settings/reports', label: 'Reports' },
  { href: '/settings/account', label: 'Account' },
];

export function SettingsSideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections">
      <ul className="-mx-1 flex min-w-0 max-w-full gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            // `shrink-0` is what makes the horizontal scroll actually work.
            // Flex items shrink by default, so on a 390px screen the strip
            // squeezed "Public sharing" onto two lines instead of
            // overflowing — a ragged row of tabs at mismatched heights.
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-md px-3 py-2 text-table font-medium transition-colors',
                  active
                    ? 'bg-primary-soft text-primary'
                    : 'text-ink-soft hover:bg-surface-2 hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
