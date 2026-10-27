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
          {/* Wraps instead of truncating: the `detail` slot carries sample-size
              notes, and a note cut to "…" with the rest only in `title` is
              unreadable on a phone (SC 1.4.13). */}
          <span className="min-w-0 break-words text-caption text-ink">
            {item.label}
            {item.detail ? <span className="ml-1.5 text-ink-soft">{item.detail}</span> : null}
          </span>
          <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-3">
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
  highlightLabel = 'your average',
  formatBin,
  title = 'Histogram',
  unit = 'speeches',
}: {
  bins: { from: number; to: number; count: number }[];
  className?: string;
  /** Bin containing the user's mean — drawn in the accent colour AND marked in text. */
  highlightIndex?: number | null;
  /** Visible text under the highlighted bin, and its meaning in the accessible name. */
  highlightLabel?: string;
  formatBin?: (from: number, to: number) => string;
  /** What is measured, for the accessible name ("Speaker scores"). */
  title?: string;
  /** What a count counts, for the accessible name. */
  unit?: string;
}) {
  if (bins.length === 0) return null;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const label = formatBin ?? ((from: number) => String(Math.round(from)));
  const total = bins.reduce((n, b) => n + b.count, 0);
  const highlighted = highlightIndex != null ? bins[highlightIndex] : undefined;

  // A text alternative that carries every figure the bars draw (SC 1.1.1).
  // The bars themselves are aria-hidden: twelve unlabelled divs are noise.
  const summary =
    `${title}: ${total} ${unit} in ${bins.length} bands. ` +
    bins.map((b) => `${b.from} to under ${b.to}: ${b.count}`).join('; ') +
    '.' +
    (highlighted
      ? ` The band ${highlighted.from} to under ${highlighted.to} holds ${highlightLabel}.`
      : '');

  // Bars scale to 85% of the plot so the count printed above the tallest one
  // still fits inside it.
  const height = (count: number) => (count > 0 ? Math.max((count / max) * 85, 3) : 0);

  return (
    <div className={cn('w-full', className)}>
      {/*
        Why the columns are absolutely positioned. The previous version put
        each column in `flex h-28 items-end`, so a column was only as tall as
        its content, and a bar's `height: N%` resolved against that
        indefinite height — every bar rendered 0 px tall (measured at 390 px
        and 1280 px; the July audit saw the same empty chart). Now every
        column is `h-full` of a fixed-height row, which is a definite height,
        and the bar is pinned to its bottom edge, so the percentage has
        something to resolve against in every engine and in print.
      */}
      <div role="img" aria-label={summary} className="flex h-28 gap-1">
        {bins.map((b, i) => {
          const h = height(b.count);
          return (
            <div key={`${b.from}-${b.to}`} aria-hidden className="relative h-full min-w-0 flex-1">
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0 rounded-t-sm',
                  // Non-highlighted bars at full `ink-soft` (5.3:1 light,
                  // 6.0:1 dark), not `ink/15`, which measured about 1.3:1 and
                  // failed SC 1.4.11 for graphical objects.
                  i === highlightIndex ? 'bg-primary' : 'bg-ink-soft',
                )}
                style={{ height: `${h}%` }}
              />
              {b.count > 0 ? (
                <span
                  className="num absolute inset-x-0 text-center text-[12px] leading-none text-ink-soft"
                  style={{ bottom: `calc(${h}% + 2px)` }}
                >
                  {b.count}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div aria-hidden className="mt-1.5 flex gap-1 border-t border-border pt-1.5">
        {bins.map((b) => (
          <span
            key={`${b.from}-${b.to}-label`}
            className="num min-w-0 flex-1 text-center text-[12px] leading-none text-ink-soft"
          >
            {label(b.from, b.to)}
          </span>
        ))}
      </div>
      {highlighted ? (
        // Colour is never the only cue (SC 1.4.1): the accent bar is also
        // marked with a glyph in its own column, and a key line says what the
        // glyph means. The key is a separate line rather than "▲ you" under
        // the bar because a twelve-band histogram leaves a column about 25 px
        // wide on a phone, and a word there overflows the panel.
        <>
          <div aria-hidden className="mt-1 flex gap-1">
            {bins.map((b, i) => (
              <span
                key={`${b.from}-${b.to}-mark`}
                className="min-w-0 flex-1 text-center text-[12px] leading-none text-ink"
              >
                {i === highlightIndex ? '▲' : ''}
              </span>
            ))}
          </div>
          <p aria-hidden className="mt-1.5 text-caption text-ink-soft">
            <span className="text-ink">▲</span> marks the band holding {highlightLabel}:{' '}
            <span className="num">
              {highlighted.from} to under {highlighted.to}
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}
