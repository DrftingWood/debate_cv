import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type ResultLineProps = {
  /** Tournament name. */
  title: React.ReactNode;
  /** Right-aligned mono figure on line one — usually the year. */
  meta?: React.ReactNode;
  /** Line two: a dense mono data string, e.g. `3rd · 74.2 avg · #8 spk · QF`. */
  data?: React.ReactNode;
  /** Earned result rendered after the data string (use <BreakMarker>). */
  result?: React.ReactNode;
  /** Gold edge-rule for rows carrying a break or title. */
  broke?: boolean;
  className?: string;
  children?: React.ReactNode;
};

// The mobile unit of the record — designed before the desktop table, since
// the audience reads tabs on phones between rounds. Two dense lines per
// tournament, scannable with a thumb and deliberately screenshot-able.
export function ResultLine({ title, meta, data, result, broke, className, children }: ResultLineProps) {
  return (
    <div
      className={cn(
        'border-b border-record-rule/40 py-2.5',
        broke && 'border-l-2 border-l-break-gold pl-3',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-table font-semibold text-record-ink">{title}</span>
        {meta !== undefined ? <span className="num shrink-0 text-caption text-record-muted">{meta}</span> : null}
      </div>
      {(data || result) ? (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-caption text-record-muted">
          {data}
          {result}
        </div>
      ) : null}
      {children}
    </div>
  );
}
