import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type BarListItem = {
  label: string;
  value: number;
  /** Rendered at the end of the row; defaults to the raw value. */
  display?: string;
  /** Muted secondary text after the label, e.g. a sample-size note. */
  detail?: string;
};

/**
 * Horizontal bar rows for the analytics page (per-round profile, format
 * slices). Plain divs sized by percentage — server-rendered, prints fine,
 * no chart library. Bars scale against the max value in the list.
 */
export function BarList({ items, className }: { items: BarListItem[]; className?: string }) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.value), 0);

  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
          <span className="truncate text-caption text-record-ink" title={item.label}>
            {item.label}
            {item.detail ? (
              <span className="ml-1.5 text-record-muted">{item.detail}</span>
            ) : null}
          </span>
          <span className="h-2 overflow-hidden rounded-sm bg-record-ink/[0.06]">
            <span
              className="block h-full rounded-sm bg-record-ink/70"
              style={{ width: max > 0 ? `${Math.max((item.value / max) * 100, 1.5)}%` : '0%' }}
            />
          </span>
          <span className="num text-caption text-record-ink">{item.display ?? String(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}
