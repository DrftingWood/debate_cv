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
        'relative rounded px-1 py-1 transition-colors',
        isActive ? 'text-ink-1 font-medium' : 'text-ink-3 hover:text-ink-1',
        className,
      )}
    >
      {children}
      {isActive ? (
        <span
          aria-hidden
          className="absolute -bottom-[17px] left-0 right-0 h-[2px] bg-primary-600"
        />
      ) : null}
    </Link>
  );
}
