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
        'flex flex-col items-center text-center rounded-lg border border-dashed border-border bg-bg px-6 py-10',
        className,
      )}
    >
      {icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-muted text-ink-3 mb-3">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink-1">{title}</h3>
      {description ? <p className="mt-1 text-sm text-ink-3 max-w-md">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
