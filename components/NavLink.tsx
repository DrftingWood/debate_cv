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
  alsoMatch,
  except,
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
  /**
   * Extra path prefixes that also light this item, and prefixes that never
   * do. Needed where one header item owns pages outside its own URL space
   * (NV-3). Since the 2026-10-29 navigation change every header item owns
   * exactly its own path, so nothing passes these today; they stay for the
   * next destination that does.
   */
  alsoMatch?: string[];
  except?: string[];
}) {
  const pathname = usePathname();
  const under = (prefix: string) =>
    pathname === prefix || (pathname?.startsWith(prefix + '/') ?? false);
  const isActive =
    !except?.some(under) &&
    ((exact ? pathname === href : pathname === href || (href !== '/' && under(href))) ||
      Boolean(alsoMatch?.some(under)));
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        // min-h-[44px]: these were 21px tall — the app's primary navigation,
        // on every page, below the 24x24 WCAG 2.2 AA floor.
        'inline-flex items-center rounded-md px-2.5 py-1.5 transition-colors duration-150 ease-soft coarse:min-h-[44px] coarse:py-0',
        // Two cues, not one (UX-47): a heavier weight and an underline bar
        // survive greyscale and forced colours, where a tint does not.
        isActive
          ? 'bg-surface-2 font-semibold text-ink shadow-[inset_0_-2px_0_hsl(var(--foreground))]'
          : 'text-ink-soft hover:bg-surface-2 hover:text-ink',
        className,
      )}
    >
      {children}
    </Link>
  );
}
