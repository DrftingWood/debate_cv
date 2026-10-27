import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /**
   * Heading level of the title. Defaults to 2: the panel almost always sits
   * straight under a page's h1 (/cv, /cv/stats, /cv/motions, the
   * dashboard), and the hard-coded h3 skipped a level on every one (UX-3).
   */
  headingLevel?: 2 | 3 | 4;
};

/**
 * The "nothing here yet" panel. Dashed border rather than solid: a solid
 * panel reads as a real statement sheet with no rows on it, which looks
 * like a bug. Dashed reads as a placeholder waiting to be filled.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-card border border-dashed border-border bg-card px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-surface-2 text-primary">
          {icon}
        </div>
      ) : null}
      <Heading className="font-display text-h4 font-medium text-ink">{title}</Heading>
      {description ? (
        <p className="mt-2 max-w-md text-ui leading-relaxed text-ink-soft">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
