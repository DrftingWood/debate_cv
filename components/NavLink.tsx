'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/' && pathname?.startsWith(href));
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative rounded px-0.5 py-1 transition-colors duration-[180ms] ease-soft',
        isActive ? 'text-ink' : 'text-ink-soft hover:text-ink',
        className,
      )}
    >
      {children}
      {isActive ? (
        <span
          aria-hidden
          className="absolute -bottom-[12px] left-0 right-0 h-[2px] bg-oxblood"
        />
      ) : null}
    </Link>
  );
}
