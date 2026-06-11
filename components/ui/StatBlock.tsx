import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type StatBlockProps = {
  label: string;
  value: React.ReactNode;
  sub?: string;
  className?: string;
};

// A headline fact on the record: big tabular numeral over a ruled label.
// Used for masthead metrics on /cv, /u and the sample — the credential a
// reader should absorb without scrolling.
export function StatBlock({ label, value, sub, className }: StatBlockProps) {
  return (
    <div className={cn('border-t-2 border-record-ink pt-2', className)}>
      <div className="font-mono text-stat font-medium leading-none text-record-ink">{value}</div>
      <div className="data-label mt-1.5">{label}</div>
      {sub ? <div className="mt-0.5 text-caption text-record-muted">{sub}</div> : null}
    </div>
  );
}
