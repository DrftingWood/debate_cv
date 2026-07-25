import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type TrendPoint = {
  label: string;
  value: number;
  /** Optional secondary figure shown under the label (e.g. sample size). */
  sub?: string;
};

/**
 * Server-rendered SVG line/area chart. Hand-rolled rather than pulling a
 * charting library: the series is a handful of points per user, plain SVG
 * keeps the page a Server Component (no client bundle, prints correctly),
 * and the statement look wants a quiet hairline plot rather than a chart
 * kit's defaults.
 *
 * Conventions borrowed from a brokerage chart: horizontal gridlines only,
 * a filled gradient under the line, value labels on the dots, and an axis
 * band at the bottom carrying the category label.
 */
export function TrendChart({
  points,
  formatValue = (n) => n.toFixed(1),
  className,
  color = 'accent',
  /** Draw a dashed line at this value (e.g. a career mean) if provided. */
  baseline,
  baselineLabel,
  height = 168,
  showValues = true,
  domain,
}: {
  points: TrendPoint[];
  formatValue?: (n: number) => string;
  className?: string;
  color?: 'accent' | 'blue' | 'gold' | 'ink';
  baseline?: number | null;
  baselineLabel?: string;
  height?: number;
  showValues?: boolean;
  /**
   * Fixed y-axis range. Required for BOUNDED series: a percentile lives on
   * 0–100, and letting the axis auto-fit produced gridlines at −4 and 104,
   * which are not values the quantity can take. Auto-fit stays the default
   * for unbounded series like speaker scores.
   */
  domain?: [number, number];
}) {
  // Hooks before any early return — the gradient id has to be stable across
  // renders and hooks cannot sit behind the empty-series guard.
  const gradientId = React.useId();
  if (points.length === 0) return null;

  const W = 640;
  const H = height;
  // Left gutter carries the gridline values; wide enough that a 4-digit
  // label never collides with the first plotted point.
  const padL = 46;
  const padR = 20;
  const padTop = showValues ? 26 : 14;
  const padBottom = 30;

  const stroke =
    color === 'blue'
      ? 'hsl(var(--score-blue))'
      : color === 'gold'
        ? 'hsl(var(--break-gold))'
        : color === 'ink'
          ? 'hsl(var(--foreground))'
          : 'hsl(var(--primary))';

  const values = points.map((p) => p.value);
  const withBase = baseline == null ? values : [...values, baseline];
  const min = Math.min(...withBase);
  const max = Math.max(...withBase);
  // A flat series (or a single point) still needs a non-zero range to map on.
  const range = max - min || Math.abs(max) * 0.1 || 1;
  const [lo, hi] = domain ?? [min - range * 0.2, max + range * 0.2];

  const x = (i: number) =>
    points.length === 1 ? (W - padL - padR) / 2 + padL : padL + (i * (W - padL - padR)) / (points.length - 1);
  const y = (v: number) => padTop + (H - padTop - padBottom) * (1 - (v - lo) / (hi - lo));

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(' ');
  const area =
    points.length > 1
      ? `${line} L ${x(points.length - 1).toFixed(1)} ${H - padBottom} L ${x(0).toFixed(1)} ${H - padBottom} Z`
      : '';

  // Three gridlines. On a fixed domain they sit at the ends and the middle
  // (0 / 50 / 100 for a percentile); on an auto-fitted one they inset so the
  // labels don't sit on the plot's edge.
  const gridValues = domain
    ? [lo, (lo + hi) / 2, hi]
    : [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];

  // Label thinning. Past roughly eight points the category labels collide —
  // at eleven tournaments they overlapped into an unreadable smear. Drop
  // every other label rather than shrinking the type past legibility, and
  // always keep the first and last so the axis stays anchored.
  const labelStride = points.length > 8 ? 2 : 1;
  const showLabel = (i: number) =>
    labelStride === 1 || i === 0 || i === points.length - 1 || i % labelStride === 0;

  return (
    <div className={cn('text-ink', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={points.map((p) => `${p.label}: ${formatValue(p.value)}`).join(', ')}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        {gridValues.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={y(v)}
              x2={W - padR}
              y2={y(v)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={padL - 6}
              y={y(v) + 3}
              textAnchor="end"
              fontSize={9.5}
              fill="currentColor"
              fillOpacity={0.45}
              className="num"
            >
              {formatValue(v)}
            </text>
          </g>
        ))}

        {baseline != null ? (
          <g>
            <line
              x1={padL}
              y1={y(baseline)}
              x2={W - padR}
              y2={y(baseline)}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeDasharray="3 3"
            />
            {baselineLabel
              ? (() => {
                  // Place the label at whichever END of the plot has the most
                  // vertical clearance from the baseline, on the far side of
                  // that end's data point. Fixed placement collided in both
                  // directions: right-anchored it overprinted the last
                  // point's value label, left-anchored it ran through a
                  // series that starts near the baseline.
                  const first = points[0].value;
                  const last = points[points.length - 1].value;
                  const atStart =
                    Math.abs(y(first) - y(baseline)) >= Math.abs(y(last) - y(baseline));
                  const anchorValue = atStart ? first : last;
                  // Point above the line → label below it, and vice versa.
                  const dy = y(anchorValue) < y(baseline) ? 13 : -6;
                  return (
                    <text
                      x={atStart ? padL + 4 : W - padR}
                      y={y(baseline) + dy}
                      textAnchor={atStart ? 'start' : 'end'}
                      fontSize={9.5}
                      fill="currentColor"
                      fillOpacity={0.5}
                    >
                      {baselineLabel}
                    </text>
                  );
                })()
              : null}
          </g>
        ) : null}

        {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
        <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" />

        {points.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle cx={x(i)} cy={y(p.value)} r={3} fill="hsl(var(--card))" stroke={stroke} strokeWidth={1.75} />
            {showValues ? (
              // Anchor the end points inward. A centred label on the first
              // point overhangs into the axis gutter and collides with the
              // gridline values; on the last point it runs off the plot.
              <text
                x={i === 0 ? x(i) - 2 : i === points.length - 1 ? x(i) + 2 : x(i)}
                y={y(p.value) - 10}
                textAnchor={
                  i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'
                }
                fontSize={10.5}
                fill="currentColor"
                className="num"
              >
                {formatValue(p.value)}
              </text>
            ) : null}
            {showLabel(i) ? (
              <>
                <text
                  x={x(i)}
                  y={H - padBottom + 15}
                  textAnchor="middle"
                  fontSize={10}
                  fill="currentColor"
                  fillOpacity={0.55}
                  className="num"
                >
                  {p.label}
                </text>
                {p.sub ? (
                  <text
                    x={x(i)}
                    y={H - padBottom + 26}
                    textAnchor="middle"
                    fontSize={9}
                    fill="currentColor"
                    fillOpacity={0.38}
                  >
                    {p.sub}
                  </text>
                ) : null}
              </>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * Inline sparkline for table rows and tiles — no axes, no labels, just the
 * shape of a series at glanceable size.
 */
export function Sparkline({
  values,
  className,
  color = 'accent',
  width = 96,
  height = 24,
}: {
  values: number[];
  className?: string;
  color?: 'accent' | 'blue' | 'ink' | 'pos' | 'neg';
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const stroke =
    color === 'blue'
      ? 'hsl(var(--score-blue))'
      : color === 'pos'
        ? 'hsl(var(--pos))'
        : color === 'neg'
          ? 'hsl(var(--neg))'
          : color === 'ink'
            ? 'hsl(var(--foreground))'
            : 'hsl(var(--primary))';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / range);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={1.9} fill={stroke} />
    </svg>
  );
}
