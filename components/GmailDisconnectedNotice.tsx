import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Warning banner shown when the Gmail grant is gone. Shared by /dashboard and
 * /cv so the markup stays in one place. The region is named by its visible
 * title (aria-labelledby) rather than a duplicate aria-label (CV-14).
 */
export function GmailDisconnectedNotice({
  children,
  action,
  className,
  ...rest
}: {
  children: React.ReactNode;
  action: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'children'>) {
  const titleId = React.useId();
  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-3 rounded-card border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.06)] p-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      {...rest}
    >
      <div>
        <div id={titleId} className="data-label text-warning">
          Gmail disconnected
        </div>
        <p className="mt-1 text-table text-ink">{children}</p>
      </div>
      {action}
    </section>
  );
}
