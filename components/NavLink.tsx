'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export function NavLink({
  href,
  children,
  className,
  exact = false,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** Match only the exact path — needed where one nav item's href is a
      prefix of another's (Record at /cv vs Growth at /cv/analytics). */
  exact?: boolean;
}) {
  const pathname = usePathname();
  const isActive = exact
    ? pathname === href
    : pathname === href || (href !== '/' && pathname?.startsWith(href));
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative rounded px-0.5 py-1 transition-colors duration-[180ms] ease-soft',
        isActive ? 'text-record-ink' : 'text-record-muted hover:text-record-ink',
        className,
      )}
    >
      {children}
      {isActive ? (
        <span
          aria-hidden
          className="absolute -bottom-[12px] left-0 right-0 h-[2px] bg-record-green"
        />
      ) : null}
    </Link>
  );
}
