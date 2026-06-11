import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type SectionHeaderProps = {
  title: string;
  /** Right-aligned mono figure — usually a row count. */
  count?: number | string;
  right?: React.ReactNode;
  className?: string;
};

// The Tab Sheet signature: every section of a record opens with the grammar
// of a tab's column-header row — data-face caps between a heavy ink rule
// and a hairline (see `.tab-header` in globals.css). Replaces both the
// editorial kicker and Roman-numeral section numbering.
export function SectionHeader({ title, count, right, className }: SectionHeaderProps) {
  return (
    <h2 className={cn('tab-header flex items-baseline justify-between gap-4', className)}>
      <span>{title}</span>
      {right ?? (count !== undefined ? <span className="num font-normal text-record-muted">{count}</span> : null)}
    </h2>
  );
}
