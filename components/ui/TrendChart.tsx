import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type TrendPoint = {
  label: string;
  value: number;
};

/**
 * Small server-rendered SVG line chart for the analytics page. Hand-rolled
 * instead of pulling a charting library: the data is a handful of yearly
 * points per user, plain SVG keeps the page a Server Component (no client
 * bundle, works in print), and the publication-style design wants quiet
 * hairline charts rather than a charting kit's defaults.
 */
export function TrendChart({
  points,
  formatValue = (n) => n.toFixed(1),
  className,
}: {
  points: TrendPoint[];
  formatValue?: (n: number) => string;
  className?: string;
}) {
  if (points.length === 0) return null;

  const W = 560;
  const H = 150;
  const padX = 28;
  const padTop = 26;
  const padBottom = 30;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Flat series (or a single point) still needs a non-zero range to map onto.
  const range = max - min || Math.abs(max) * 0.1 || 1;
  const lo = min - range * 0.15;
  const hi = max + range * 0.15;

  const x = (i: number) =>
    points.length === 1
      ? W / 2
      : padX + (i * (W - padX * 2)) / (points.length - 1);
  const y = (v: number) =>
    padTop + (H - padTop - padBottom) * (1 - (v - lo) / (hi - lo));

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(' ');

  return (
    <div className={cn('text-record-ink', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={points.map((p) => `${p.label}: ${formatValue(p.value)}`).join(', ')}
      >
        <line
          x1={padX}
          y1={H - padBottom}
          x2={W - padX}
          y2={H - padBottom}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.value)} r={3} fill="currentColor" />
            <text
              x={x(i)}
              y={y(p.value) - 9}
              textAnchor="middle"
              fontSize={11}
              fill="currentColor"
              className="num"
            >
              {formatValue(p.value)}
            </text>
            <text
              x={x(i)}
              y={H - padBottom + 17}
              textAnchor="middle"
              fontSize={10.5}
              fill="currentColor"
              fillOpacity={0.55}
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
