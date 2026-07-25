'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

/**
 * Primary nav item. The active state is a filled pill rather than an
 * underline: the header sits on a tinted canvas, and a pill reads as
 * "you are in this section of the account" the way a banking sidebar does.
 */
export function NavLink({
  href,
  children,
  className,
  exact,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Match the path exactly. Needed wherever a section root sits above its
   * own children in the same nav — /cv would otherwise stay lit while the
   * user is on /cv/stats, and two nav items would claim to be current.
   */
  exact?: boolean;
}) {
  const pathname = usePathname();
  const isActive = exact
    ? pathname === href
    : pathname === href || (href !== '/' && (pathname?.startsWith(href) ?? false));
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        // min-h-[44px]: these were 21px tall — the app's primary navigation,
        // on every page, below the 24x24 WCAG 2.2 AA floor.
        'inline-flex items-center rounded-md px-2.5 py-1.5 transition-colors duration-150 ease-soft coarse:min-h-[44px] coarse:py-0',
        isActive ? 'bg-surface-2 text-ink' : 'text-ink-soft hover:bg-surface-2 hover:text-ink',
        className,
      )}
    >
      {children}
    </Link>
  );
}
