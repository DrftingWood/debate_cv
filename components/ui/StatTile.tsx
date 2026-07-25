import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The account-summary tile. Every headline figure in the product renders
 * through this so the hierarchy is identical everywhere: a mono micro-label,
 * a large tabular figure, an optional directional delta, and an optional
 * footnote carrying the sample size or source.
 *
 * Deliberately NOT a Card: tiles usually sit inside one shared panel,
 * separated by hairline rules (see `StatRow`), the way a bank shows
 * balance / available / pending across one strip rather than three boxes.
 */
export type Trend = 'up' | 'down' | 'flat';

export function DeltaChip({
  value,
  trend,
  className,
}: {
  /** Pre-formatted delta text, e.g. "+2.8" or "+14%". */
  value: string;
  /**
   * Direction as a VALUE JUDGEMENT, not arithmetic: a rank moving from 40th
   * to 12th is 'up' even though the number fell. Callers decide.
   */
  trend: Trend;
  className?: string;
}) {
  const tone =
    trend === 'up' ? 'text-pos bg-pos-soft' : trend === 'down' ? 'text-neg bg-neg-soft' : 'text-ink-soft bg-surface-2';
  const glyph = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-kicker font-medium tabular-nums',
        tone,
        className,
      )}
    >
      <span aria-hidden className="text-[8px] leading-none">{glyph}</span>
      {value}
    </span>
  );
}

export function StatTile({
  label,
  value,
  delta,
  trend = 'flat',
  hint,
  size = 'md',
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Pre-formatted delta text; omit to hide the chip. */
  delta?: string | null;
  trend?: Trend;
  /** Footnote: sample size, denominator, or the source of the figure. */
  hint?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Tints the figure. Use only when the figure itself is a judgement. */
  accent?: 'gold' | 'blue' | 'pos' | 'neg';
  className?: string;
}) {
  const figureSize =
    size === 'lg' ? 'text-figure-lg' : size === 'sm' ? 'text-figure-sm' : 'text-figure-md';
  const accentClass =
    accent === 'gold'
      ? 'text-break-gold'
      : accent === 'blue'
        ? 'text-score-blue'
        : accent === 'pos'
          ? 'text-pos'
          : accent === 'neg'
            ? 'text-neg'
            : 'text-ink';

  return (
    <div className={cn('min-w-0', className)}>
      <div className="data-label truncate" title={label}>
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={cn('figure', figureSize, accentClass)}>{value}</span>
        {delta ? <DeltaChip value={delta} trend={trend} /> : null}
      </div>
      {hint ? <div className="mt-1 text-caption text-ink-soft">{hint}</div> : null}
    </div>
  );
}

/**
 * A strip of tiles inside one panel, divided by hairlines — the bank's
 * balance bar. Falls back to a two-column grid on narrow screens, where
 * vertical dividers would crowd the figures.
 */
export function StatRow({
  children,
  className,
  columns,
}: {
  children: React.ReactNode;
  className?: string;
  /** Column count at md and up. Defaults to the child count. */
  columns?: number;
}) {
  const count = columns ?? React.Children.count(children);
  const cols =
    count >= 5
      ? 'md:grid-cols-5'
      : count === 4
        ? 'md:grid-cols-4'
        : count === 3
          ? 'md:grid-cols-3'
          : count === 2
            ? 'md:grid-cols-2'
            : 'md:grid-cols-1';
  return (
    <div
      className={cn(
        'panel grid grid-cols-2 gap-px overflow-hidden bg-border',
        cols,
        className,
      )}
    >
      {React.Children.map(children, (child, i) => (
        <div key={i} className="bg-card px-4 py-4">
          {child}
        </div>
      ))}
    </div>
  );
}
