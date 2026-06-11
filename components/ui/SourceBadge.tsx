import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type SourceBadgeProps = {
  /** Tab page the row was parsed from. Verified rows link to their source. */
  href?: string | null;
  label?: string;
  className?: string;
};

// Verification as a visible property of every row: a terse mono chip that
// links straight to the tournament tab the data came from. Green because
// green means verified/act — never decoration.
export function SourceBadge({ href, label = 'TAB', className }: SourceBadgeProps) {
  const inner = (
    <>
      <span aria-hidden>✓</span>
      {label}
    </>
  );
  const base =
    'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]';
  if (!href) {
    return (
      <span className={cn(base, 'border-record-rule/60 text-record-muted', className)} title="Source link unavailable">
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the source tab"
      className={cn(base, 'border-record-green/40 text-record-green hover:bg-record-green/[0.06]', className)}
    >
      {inner}
    </a>
  );
}
