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
        'flex flex-col items-center text-center rounded-card border border-dashed border-record-ink/15 bg-sheet px-6 py-12',
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-record-green-soft text-record-green">
          {icon}
        </div>
      ) : null}
      <h3 className="font-display text-h3 text-record-ink">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md font-display text-ui leading-relaxed text-record-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
