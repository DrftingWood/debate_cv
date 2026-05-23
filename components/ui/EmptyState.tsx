import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center rounded-card border border-dashed border-ink/15 bg-paper px-6 py-12',
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-oxblood-soft text-oxblood">
          {icon}
        </div>
      ) : null}
      <h3 className="font-serif text-h3 italic text-ink">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md font-serif text-[14.5px] leading-relaxed text-ink-soft">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
