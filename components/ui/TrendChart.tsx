'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Table, Th, Td } from '@/components/ui/DataTable';

export type TrendPoint = {
  label: string;
  value: number;
  /** Optional secondary figure shown under the label (e.g. sample size). */
  sub?: string;
  /** What the point is (a tournament), shown in the hover readout. */
  name?: string;
};

/**
 * Hand-rolled SVG line/area chart. No charting library: the series is a
 * handful of points per user, and the statement look wants a quiet hairline
 * plot rather than a chart kit's defaults.
 *
 * Redrawn 2026-10-29 to the dataviz research (owner: "the data visualisation
 * is ugly"; rules in reports/debate_cv-dataviz-issues-2026-10-29.md):
 * - Values are labelled selectively: the last point and the extremes. A
 *   number on every dot goes unread; the rest live in the readout and table.
 * - One axis tick per distinct label. Points are tournaments labelled by
 *   year, and the old axis printed "2021 2021 2022 2022".
 * - The first and last points sit in from the plot edge, so the first tick
 *   clears the y-axis labels (the "0" printed over "2021").
 * - Gridlines and the reference line are solid hairlines; a dashed rule
 *   reads as a projection.
 * - A 2 px line over a 10% wash; filled dots ringed in the card colour.
 * - A crosshair readout on hover, touch and arrow keys: value first, then
 *   the tournament and year. It enhances, never gates.
 *
 * Why this is a client component. Text in an SVG scales with the viewBox, so
 * the chart draws in the container's real width (a ResizeObserver measures
 * it) and its 12 px labels stay 12 px on a phone (SC 1.4.4). The server
 * render and first frame use a 640-unit width; the box height is fixed, so
 * nothing below moves when the measurement lands.
 *
 * Every chart carries a text alternative (UX-32): an accessible name from
 * `title`, a <desc> listing every point, and the same figures as a real
 * table behind a disclosure.
 */
export function TrendChart({
  points,
  formatValue = (n) => n.toFixed(1),
  className,
  color = 'accent',
  /** Draw a reference line at this value (e.g. a career mean) if provided. */
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
   * 0–100, and letting the axis auto-fit produced gridlines at −4 and 104.
   */
  domain?: [number, number];
  /** What is measured: the chart's accessible name and the table caption. */
  title?: string;
  /** Header of the value column in the data table ("Percentile"). */
  valueLabel?: string;
}) {
  const id = React.useId();
  const frameRef = React.useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = React.useState<number | null>(null);
  const [active, setActive] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      // A hidden ancestor (display:none, a collapsed <details>) reports 0.
      if (w > 0) setMeasured((prev) => (prev === w ? prev : w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length === 0) return null;

  const W = Math.max(measured ?? 640, 240);
  const H = height;
  const padL = 40;
  const padR = 16;
  const padTop = showValues ? 24 : 12;
  // A second axis line (the sample under each label) needs its own band.
  const padBottom = points.some((p) => p.sub) ? 42 : 28;
  const inset = 14;

  const stroke =
    color === 'blue'
      ? 'hsl(var(--score-blue))'
      : color === 'gold'
        ? 'hsl(var(--break-gold))'
        : color === 'ink'
          ? 'hsl(var(--foreground))'
          : 'hsl(var(--primary))';
  // Chart text in the muted-foreground token at full strength (5.3:1 light,
  // 6.0:1 dark); opacity only on gridlines (SC 1.4.3).
  const muted = 'hsl(var(--muted-foreground))';
  const ink = 'hsl(var(--foreground))';
  const surface = 'hsl(var(--card))';

  const values = points.map((p) => p.value);
  const withBase = baseline == null ? values : [...values, baseline];
  const min = Math.min(...withBase);
  const max = Math.max(...withBase);
  const range = max - min || Math.abs(max) * 0.1 || 1;
  const [lo, hi] = domain ?? [min - range * 0.2, max + range * 0.2];

  const last = points.length - 1;
  const plotL = padL + inset;
  const plotR = W - padR - inset;
  const x = (i: number) =>
    points.length === 1 ? (plotL + plotR) / 2 : plotL + (i * (plotR - plotL)) / last;
  const y = (v: number) => padTop + (H - padTop - padBottom) * (1 - (v - lo) / (hi - lo));
  const floor = H - padBottom;

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(' ');
  const area =
    points.length > 1
      ? `${line} L ${x(last).toFixed(1)} ${floor} L ${x(0).toFixed(1)} ${floor} Z`
      : '';

  const gridValues = domain
    ? [lo, (lo + hi) / 2, hi]
    : [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];

  // Selective value labels: the last point, the highest and the lowest.
  const hiIdx = values.indexOf(Math.max(...values));
  const loIdx = values.indexOf(Math.min(...values));
  const labelled = new Set(showValues ? [last, hiIdx, loIdx] : []);

  // One tick per distinct label, thinned by the space available; the first
  // and last ticks stay so the axis is anchored.
  const ticks = points
    .map((_, i) => i)
    .filter((i) => i === 0 || points[i].label !== points[i - 1].label);
  const CHAR_W = 7.4; // a 12 px mono glyph
  const widest = Math.max(...points.map((p) => Math.max(p.label.length, p.sub?.length ?? 0)));
  const room = (plotR - plotL) / Math.max(ticks.length - 1, 1);
  const stride = Math.max(1, Math.ceil((widest * CHAR_W + 10) / room));
  const shownTicks = new Set(
    ticks.filter(
      (_, k) =>
        k === 0 || k === ticks.length - 1 || (k % stride === 0 && ticks.length - 1 - k >= stride),
    ),
  );

  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const hasSub = points.some((p) => p.sub);
  const desc =
    points
      .map(
        (p) =>
          `${p.name ? `${p.name}, ` : ''}${p.label}: ${formatValue(p.value)}${p.sub ? ` (${p.sub})` : ''}`,
      )
      .join('; ') +
    '.' +
    (baseline != null && baselineLabel
      ? ` Reference line: ${baselineLabel}, ${formatValue(baseline)}.`
      : '');

  // Nearest point by x only: readers aim at a year, not at a 6 px dot.
  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    }
    return best;
  };
  const a = active == null ? null : points[active];

  return (
    <div className={cn('text-ink', className)}>
      <div ref={frameRef} className="relative" style={{ height: H }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          className="block touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          tabIndex={0}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
          onPointerDown={(e) => setActive(nearest(e.clientX, e.currentTarget))}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const step = e.key === 'ArrowRight' ? 1 : -1;
              setActive((cur) =>
                cur == null ? (step > 0 ? 0 : last) : Math.min(last, Math.max(0, cur + step)),
              );
            } else if (e.key === 'Escape') setActive(null);
          }}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{desc}</desc>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.1} />
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
                x={padL - 8}
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
                strokeOpacity={0.3}
              />
              {baselineLabel
                ? (() => {
                    // At whichever end has more clearance from the line, on
                    // the far side of that end's point.
                    const first = points[0].value;
                    const lastValue = points[last].value;
                    const atStart =
                      Math.abs(y(first) - y(baseline)) >= Math.abs(y(lastValue) - y(baseline));
                    const anchorValue = atStart ? first : lastValue;
                    const dy = y(anchorValue) < y(baseline) ? 14 : -6;
                    return (
                      <text
                        x={atStart ? plotL : plotR}
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
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {active != null ? (
            <line
              x1={x(active)}
              y1={padTop - 8}
              x2={x(active)}
              y2={floor}
              stroke="currentColor"
              strokeOpacity={0.25}
            />
          ) : null}

          {points.map((p, i) => (
            <g key={`${p.label}-${i}`}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={i === active ? 5 : i === last ? 4 : 3}
                fill={stroke}
                stroke={surface}
                strokeWidth={2}
              />
              {labelled.has(i) && i !== active ? (
                <text
                  x={x(i)}
                  // Below the dot when the line arrives from above, so the
                  // label never sits on its own segment.
                  y={i > 0 && points[i - 1].value > p.value ? y(p.value) + 18 : y(p.value) - 10}
                  textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
                  fontSize={12}
                  fill={ink}
                  className="num"
                >
                  {formatValue(p.value)}
                </text>
              ) : null}
              {shownTicks.has(i) ? (
                <>
                  <text
                    x={x(i)}
                    y={floor + 16}
                    textAnchor="middle"
                    fontSize={12}
                    fill={muted}
                    className="num"
                  >
                    {p.label}
                  </text>
                  {p.sub ? (
                    <text x={x(i)} y={floor + 30} textAnchor="middle" fontSize={12} fill={muted}>
                      {p.sub}
                    </text>
                  ) : null}
                </>
              ) : null}
            </g>
          ))}
        </svg>

        {a != null && active != null ? (
          // Value first and strong, what it is second. It flips to the left
          // of the crosshair past the middle so it stays inside the plot.
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-card px-2.5 py-1.5 shadow-sm"
            style={
              x(active) > W / 2
                ? { right: `${((W - x(active) + 8) / W) * 100}%` }
                : { left: `${((x(active) + 8) / W) * 100}%` }
            }
          >
            <div className="num text-ui font-semibold text-ink">{formatValue(a.value)}</div>
            <div className="whitespace-nowrap text-caption text-ink-soft">
              {a.name ? a.name : ''}
              {/* The year only when the name doesn't already carry it. */}
              {!a.name ? a.label : a.name.includes(a.label) ? '' : ` · ${a.label}`}
              {a.sub ? ` · ${a.sub}` : ''}
            </div>
          </div>
        ) : null}
      </div>
      <details className="mt-2" data-print-hide="true">
        <summary className="cursor-pointer py-1 text-caption text-ink-soft hover:text-ink coarse:py-2">
          Show the figures as a table
        </summary>
        <div className="mt-2 max-w-md">
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
                  <Td>{p.name ? `${p.name} (${p.label})` : p.label}</Td>
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
