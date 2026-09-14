import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type BarListItem = {
  label: string;
  value: number;
  /** Rendered at the end of the row; defaults to the raw value. */
  display?: string;
  /** Muted secondary text after the label, e.g. a sample-size note. */
  detail?: string;
  /**
   * Colour override for a single row. Use only when the row's value is a
   * judgement (above/below a baseline), never to distinguish categories.
   */
  tone?: 'default' | 'pos' | 'neg' | 'gold' | 'blue';
};

/**
 * Horizontal bar rows — the allocation breakdown of a statement. Plain divs
 * sized by percentage: server-rendered, prints fine, no chart library. Bars
 * scale against the largest value in the list, and the figure column is
 * right-aligned mono so a stack of rows reads as a column of numbers.
 */
export function BarList({
  items,
  className,
  labelWidth = '8rem',
}: {
  items: BarListItem[];
  className?: string;
  labelWidth?: string;
}) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.value), 0);

  const fill: Record<NonNullable<BarListItem['tone']>, string> = {
    default: 'bg-primary/60',
    pos: 'bg-pos/70',
    neg: 'bg-neg/70',
    gold: 'bg-break-gold/70',
    blue: 'bg-score-blue/70',
  };

  return (
    <ul className={cn('space-y-1.5', className)}>
      {items.map((item) => (
        <li
          key={item.label}
          className="grid items-center gap-3"
          style={{ gridTemplateColumns: `${labelWidth} 1fr auto` }}
        >
          <span className="truncate text-caption text-ink" title={item.label}>
            {item.label}
            {item.detail ? <span className="ml-1.5 text-ink-soft">{item.detail}</span> : null}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <span
              className={cn('block h-full rounded-full', fill[item.tone ?? 'default'])}
              style={{ width: max > 0 ? `${Math.max((item.value / max) * 100, 1.5)}%` : '0%' }}
            />
          </span>
          <span className="num text-caption tabular-nums text-ink">
            {item.display ?? String(item.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A single labelled meter — "you are here" on a 0–100 track. Used for
 * percentile placement, break conversion, win rates: any figure whose
 * meaning depends on where it sits inside a known range.
 */
export function Meter({
  value,
  max = 100,
  label,
  display,
  tone = 'accent',
  /** Optional reference mark (e.g. the field average) drawn on the track. */
  marker,
  markerLabel,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  display?: string;
  tone?: 'accent' | 'gold' | 'blue' | 'pos' | 'neg';
  marker?: number | null;
  markerLabel?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
  const fill =
    tone === 'gold'
      ? 'bg-break-gold'
      : tone === 'blue'
        ? 'bg-score-blue'
        : tone === 'pos'
          ? 'bg-pos'
          : tone === 'neg'
            ? 'bg-neg'
            : 'bg-primary';

  return (
    <div className={cn('min-w-0', className)}>
      {label || display ? (
        <div className="flex items-baseline justify-between gap-2">
          {label ? <span className="text-caption text-ink-soft">{label}</span> : <span />}
          {display ? <span className="num text-caption text-ink">{display}</span> : null}
        </div>
      ) : null}
      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
        {marker != null && max > 0 ? (
          <div
            className="absolute inset-y-0 w-px bg-ink/45"
            style={{ left: `${Math.min(Math.max((marker / max) * 100, 0), 100)}%` }}
            title={markerLabel}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Histogram of a continuous series (speaker scores). Bins are supplied
 * pre-computed by the caller so the binning rule stays in the stats layer
 * and stays unit-testable; this component only draws.
 */
export function Histogram({
  bins,
  className,
  highlightIndex,
  formatBin,
}: {
  bins: { from: number; to: number; count: number }[];
  className?: string;
  /** Bin containing the user's mean — drawn in the accent colour. */
  highlightIndex?: number | null;
  formatBin?: (from: number, to: number) => string;
}) {
  if (bins.length === 0) return null;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const label = formatBin ?? ((from: number) => String(Math.round(from)));

  return (
    <div className={cn('w-full', className)}>
      <div className="flex h-28 items-end gap-1">
        {bins.map((b, i) => (
          <div key={`${b.from}-${b.to}`} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="num text-[12px] leading-none text-ink-soft">
              {b.count > 0 ? b.count : ''}
            </span>
            <div
              className={cn(
                'w-full rounded-t-sm',
                i === highlightIndex ? 'bg-primary' : 'bg-ink/15',
              )}
              style={{ height: `${Math.max((b.count / max) * 100, b.count > 0 ? 4 : 0)}%` }}
              title={`${b.from}–${b.to}: ${b.count}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1 border-t border-border pt-1.5">
        {bins.map((b) => (
          <span
            key={`${b.from}-${b.to}-label`}
            className="num flex-1 text-center text-[12px] leading-none text-ink-soft"
          >
            {label(b.from, b.to)}
          </span>
        ))}
      </div>
    </div>
  );
}
