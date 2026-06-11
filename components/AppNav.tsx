'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

type Item = { href: string; label: string };

/**
 * Signed-in primary nav. Resolves the active item by longest matching
 * prefix — without this, both "CV" (/cv) and "Growth" (/cv/analytics) light
 * up on the analytics page, and "Settings" (/settings) and "Share"
 * (/settings/sharing) collide on the share page. A simple per-link
 * `startsWith` check can't fix that because it doesn't know about siblings.
 */
export function AppNav({ items }: { items: Item[] }) {
  const pathname = usePathname() ?? '';

  // Pick the item whose href is the longest prefix of the current path.
  // Falls back to exact match for the root "/".
  let activeHref: string | null = null;
  let bestLen = -1;
  for (const item of items) {
    const isMatch =
      item.href === pathname ||
      (item.href !== '/' &&
        (pathname === item.href || pathname.startsWith(item.href + '/')));
    if (isMatch && item.href.length > bestLen) {
      activeHref = item.href;
      bestLen = item.href.length;
    }
  }

  return (
    <nav aria-label="Primary" className="flex items-center gap-6 text-table font-medium">
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative rounded px-0.5 py-1 transition-colors duration-[180ms] ease-soft',
              isActive ? 'text-ink' : 'text-ink-soft hover:text-ink',
            )}
          >
            {item.label}
            {isActive ? (
              <span
                aria-hidden
                className="absolute -bottom-[12px] left-0 right-0 h-[2px] bg-primary"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
