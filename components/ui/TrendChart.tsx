'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Table, Th, Td } from '@/components/ui/DataTable';

export type TrendPoint = {
  label: string;
  value: number;
  /** Optional secondary figure shown under the label (e.g. sample size). */
  sub?: string;
};

/**
 * Hand-rolled SVG line/area chart. No charting library: the series is a
 * handful of points per user, and the statement look wants a quiet hairline
 * plot rather than a chart kit's defaults.
 *
 * Conventions borrowed from a brokerage chart: horizontal gridlines only,
 * a filled gradient under the line, value labels on the dots, and an axis
 * band at the bottom carrying the category label.
 *
 * Why this is a client component. The chart used to draw into a fixed
 * 640-unit viewBox and let CSS scale it to the panel. On a phone the panel
 * is about 326 px, so every "12 px" label rendered at about 6 px (measured:
 * an 8 px text box at 390 px against 24 px at 1280; SC 1.4.4). Text in an
 * SVG scales with the viewBox, so the only way to keep it at its stated size
 * is to draw in the container's real width. A ResizeObserver measures it and
 * the chart redraws at 1 unit = 1 CSS px. The server render (and the first
 * frame) uses the old 640-unit width; the box has a fixed height either way,
 * so nothing below it moves when the measurement lands. On /cv/stats the
 * chart already sat inside the client FilterableStats tree, so this adds no
 * bundle there.
 *
 * Every chart carries a text alternative (UX-32): an accessible name from
 * `title`, a <desc> listing every point with its sample note, and the same
 * figures as a real table behind a disclosure, for anyone who wants to read
 * the numbers rather than the shape — including the labels the axis had to
 * thin out on a narrow screen.
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
  title = 'Trend',
  valueLabel = 'Value',
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
  /** What is measured: the chart's accessible name and the table caption. */
  title?: string;
  /** Header of the value column in the data table ("Percentile"). */
  valueLabel?: string;
}) {
  // Hooks before any early return — ids and the measured width have to be
  // stable across renders, and hooks cannot sit behind the empty-series guard.
  const id = React.useId();
  const frameRef = React.useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      // A hidden ancestor (display:none, a collapsed <details>) reports 0.
      // Keep the last good width rather than drawing a zero-width plot.
      if (w > 0) setMeasured((prev) => (prev === w ? prev : w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length === 0) return null;

  // Below about 240 px the gutters leave no plot; let the SVG scale down
  // slightly instead (it keeps its aspect ratio).
  const W = Math.max(measured ?? 640, 240);
  const H = height;
  // Left gutter carries the gridline values; wide enough that a 4-digit
  // label never collides with the first plotted point.
  const padL = 46;
  const padR = 20;
  const padTop = showValues ? 26 : 14;
  const padBottom = 32;

  const stroke =
    color === 'blue'
      ? 'hsl(var(--score-blue))'
      : color === 'gold'
        ? 'hsl(var(--break-gold))'
        : color === 'ink'
          ? 'hsl(var(--foreground))'
          : 'hsl(var(--primary))';
  // Chart text is drawn in the muted-foreground token at full strength
  // (5.3:1 light, 6.0:1 dark). It used `currentColor` at fillOpacity
  // 0.38–0.55, which measured 2.1–3.9:1 — the faintest being the `n=` line
  // that carries the sample size (SC 1.4.3). Opacity stays on gridlines only.
  const muted = 'hsl(var(--muted-foreground))';
  const ink = 'hsl(var(--foreground))';

  const values = points.map((p) => p.value);
  const withBase = baseline == null ? values : [...values, baseline];
  const min = Math.min(...withBase);
  const max = Math.max(...withBase);
  // A flat series (or a single point) still needs a non-zero range to map on.
  const range = max - min || Math.abs(max) * 0.1 || 1;
  const [lo, hi] = domain ?? [min - range * 0.2, max + range * 0.2];

  const plotW = W - padL - padR;
  const x = (i: number) =>
    points.length === 1 ? plotW / 2 + padL : padL + (i * plotW) / (points.length - 1);
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

  // Label thinning, by the space actually available. Labels collide once a
  // point's slot is narrower than its widest label — eleven tournaments
  // overlapped into a smear at 640 units, and a phone has half that. Drop
  // labels at a stride rather than shrinking the type past legibility; keep
  // the first and last so the axis stays anchored, and drop the one before
  // the last when it would crowd it. Every value stays in the table below.
  const last = points.length - 1;
  const slot = points.length > 1 ? plotW / last : plotW;
  const CHAR_W = 7.4; // a 12 px mono glyph
  const widest = Math.max(
    ...points.map((p) =>
      Math.max(p.label.length, p.sub?.length ?? 0, showValues ? formatValue(p.value).length : 0),
    ),
  );
  const stride = Math.max(1, Math.ceil((widest * CHAR_W + 8) / slot));
  const showLabel = (i: number) =>
    i === 0 || i === last || (i % stride === 0 && last - i >= stride);

  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const hasSub = points.some((p) => p.sub);
  const desc =
    points
      .map((p) => `${p.label}: ${formatValue(p.value)}${p.sub ? ` (${p.sub})` : ''}`)
      .join('; ') +
    '.' +
    (baseline != null && baselineLabel
      ? ` Dashed line: ${baselineLabel}, ${formatValue(baseline)}.`
      : '');

  return (
    <div className={cn('text-ink', className)}>
      <div ref={frameRef} style={{ height: H }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          className="block"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{desc}</desc>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
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
                y={y(v) + 4}
                textAnchor="end"
                fontSize={12}
                fill={muted}
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
                    const lastValue = points[last].value;
                    const atStart =
                      Math.abs(y(first) - y(baseline)) >= Math.abs(y(lastValue) - y(baseline));
                    const anchorValue = atStart ? first : lastValue;
                    // Point above the line → label below it, and vice versa.
                    const dy = y(anchorValue) < y(baseline) ? 14 : -6;
                    return (
                      <text
                        x={atStart ? padL + 4 : W - padR}
                        y={y(baseline) + dy}
                        textAnchor={atStart ? 'start' : 'end'}
                        fontSize={12}
                        fill={muted}
                      >
                        {baselineLabel}
                      </text>
                    );
                  })()
                : null}
            </g>
          ) : null}

          {area ? <path d={area} fill={`url(#${id}-fill)`} /> : null}
          <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" />

          {points.map((p, i) => (
            <g key={`${p.label}-${i}`}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={3}
                fill="hsl(var(--card))"
                stroke={stroke}
                strokeWidth={1.75}
              />
              {showValues && showLabel(i) ? (
                // Anchor the end points inward. A centred label on the first
                // point overhangs into the axis gutter and collides with the
                // gridline values; on the last point it runs off the plot.
                <text
                  x={i === 0 ? x(i) - 2 : i === last ? x(i) + 2 : x(i)}
                  y={y(p.value) - 10}
                  textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
                  fontSize={12}
                  fill={ink}
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
                    fontSize={12}
                    fill={muted}
                    className="num"
                  >
                    {p.label}
                  </text>
                  {p.sub ? (
                    <text
                      x={x(i)}
                      y={H - padBottom + 29}
                      textAnchor="middle"
                      fontSize={12}
                      fill={muted}
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
      <details className="mt-2" data-print-hide="true">
        <summary className="cursor-pointer text-caption text-ink-soft hover:text-ink coarse:py-2">
          Show the figures as a table
        </summary>
        <div className="mt-2">
          <Table label={title}>
            <thead>
              <tr>
                <Th>Point</Th>
                <Th numeric>{valueLabel}</Th>
                {hasSub ? <Th>Sample</Th> : null}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={`${p.label}-${i}`}>
                  <Td>{p.label}</Td>
                  <Td numeric>{formatValue(p.value)}</Td>
                  {hasSub ? <Td className="text-ink-soft">{p.sub ?? '—'}</Td> : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
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
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={1.9} fill={stroke} />
    </svg>
  );
}
