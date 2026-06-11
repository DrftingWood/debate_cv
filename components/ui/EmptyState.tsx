import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

// An empty section of the record: ruled like everything else on the sheet
// (heavy rule on top, hairline below), no decorative icon chrome.
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center border-t-2 border-record-ink border-b border-b-record-rule/50 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-4 text-record-muted">{icon}</div> : null}
      <h3 className="font-display text-h3 font-semibold text-record-ink">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-ui leading-relaxed text-record-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
