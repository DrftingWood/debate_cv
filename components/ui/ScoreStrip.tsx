'use client';

import * as React from 'react';
import { Table, Th, Td } from '@/components/ui/DataTable';
import { cn } from '@/lib/utils/cn';

/**
 * Every scored speech as one dot on a single score axis (owner decision
 * 2026-10-29, after the dataviz research: for ~100 scores a strip shows each
 * speech, where a histogram's bins can hide the shape; FT Visual Vocabulary
 * "dot strip", data.europa.eu beeswarm guidance). It replaces the histogram
 * that printed a count above every column.
 *
 * Reading it: dots stack at half-point steps, the precision tabs score in,
 * so a taller stack is a more common score. The shaded band is the middle
 * 50% of speeches and the ink rule the median; both are labelled once, and
 * the exact figures sit in the panel beside the chart.
 *
 * Drawn at the container's real width (as TrendChart) so labels stay 12 px.
 * Hovering, tapping or arrowing across a stack reads out its score and
 * count; the same counts are in the table behind the disclosure (UX-32).
 */
export function ScoreStrip({
  scores,
  median,
  q1,
  q3,
  title,
}: {
  /** Ascending. */
  scores: number[];
  median: number | null;
  q1: number | null;
  q3: number | null;
  title: string;
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
      if (w > 0) setMeasured((prev) => (prev === w ? prev : w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (scores.length === 0) return null;

  // Stacks at half-point steps, keyed by twice the score.
  const stacks = new Map<number, number>();
  for (const s of scores) {
    const k = Math.round(s * 2);
    stacks.set(k, (stacks.get(k) ?? 0) + 1);
  }
  const keys = [...stacks.keys()].sort((a, b) => a - b);
  const lo = Math.floor(keys[0] / 2);
  const hi = Math.ceil(keys[keys.length - 1] / 2);
  const steps = Math.max(1, (hi - lo) * 2);
  const tallest = Math.max(...stacks.values());

  const W = Math.max(measured ?? 640, 240);
  const padX = 12;
  const plotW = W - padX * 2;
  const slot = plotW / steps;
  // Dot size: the smaller of the slot and what the tallest stack allows.
  const MAX_STACK_H = 132;
  const d = Math.max(3, Math.min(10, slot - 2, MAX_STACK_H / tallest - 2));
  const gap = 2;
  const stackH = tallest * (d + gap);
  const labelBand = 18;
  const padTop = labelBand + 6;
  const baseY = padTop + stackH;
  const H = baseY + 28;
  const x = (score: number) => padX + (score - lo) * 2 * slot;

  const muted = 'hsl(var(--muted-foreground))';
  const ink = 'hsl(var(--foreground))';
  const dot = 'hsl(var(--score-blue))';
  const surface = 'hsl(var(--card))';

  const ticks: number[] = [];
  const tickEvery = slot * 2 < 26 ? 2 : 1; // whole points, or every other on a phone
  for (let t = lo; t <= hi; t += tickEvery) ticks.push(t);

  const activeKey = active == null ? null : keys[active];
  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < keys.length; i++) {
      if (Math.abs(x(keys[i] / 2) - px) < Math.abs(x(keys[best] / 2) - px)) best = i;
    }
    return best;
  };

  const fmt = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1));
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const desc =
    `${scores.length} speeches from ${fmt(scores[0])} to ${fmt(scores[scores.length - 1])}` +
    (median != null ? `, median ${median.toFixed(1)}` : '') +
    (q1 != null && q3 != null ? `, middle half ${q1.toFixed(1)} to ${q3.toFixed(1)}` : '') +
    '. ' +
    keys.map((k) => `${fmt(k / 2)}: ${stacks.get(k)}`).join('; ') +
    '.';

  return (
    <div className="text-ink">
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
                cur == null
                  ? step > 0
                    ? 0
                    : keys.length - 1
                  : Math.min(keys.length - 1, Math.max(0, cur + step)),
              );
            } else if (e.key === 'Escape') setActive(null);
          }}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{desc}</desc>

          {q1 != null && q3 != null ? (
            <g>
              <rect
                x={x(q1) - d / 2}
                y={padTop - 2}
                width={Math.max(x(q3) - x(q1) + d, 2)}
                height={stackH + 2}
                fill={dot}
                fillOpacity={0.08}
                rx={3}
              />
            </g>
          ) : null}

          {median != null ? (
            <g>
              <line
                x1={x(median)}
                y1={padTop - 4}
                x2={x(median)}
                y2={baseY}
                stroke={ink}
                strokeOpacity={0.55}
              />
              <text
                x={x(median)}
                y={labelBand - 4}
                fontSize={12}
                fill={ink}
                textAnchor="middle"
                className="num"
              >
                {`median ${median.toFixed(1)}`}
              </text>
            </g>
          ) : null}

          {keys.map((k, i) => {
            const n = stacks.get(k)!;
            const cx = x(k / 2);
            return (
              <g key={k} opacity={activeKey == null || activeKey === k ? 1 : 0.45}>
                {Array.from({ length: n }, (_, j) => (
                  <circle
                    key={j}
                    cx={cx}
                    cy={baseY - d / 2 - j * (d + gap)}
                    r={d / 2}
                    fill={dot}
                    stroke={surface}
                    strokeWidth={i === active ? 0 : 0.5}
                  />
                ))}
              </g>
            );
          })}

          <line
            x1={padX}
            y1={baseY + 2}
            x2={W - padX}
            y2={baseY + 2}
            stroke="currentColor"
            strokeOpacity={0.15}
          />
          {ticks.map((t) => (
            <text
              key={t}
              x={x(t)}
              y={baseY + 18}
              fontSize={12}
              fill={muted}
              textAnchor="middle"
              className="num"
            >
              {t}
            </text>
          ))}
        </svg>

        {activeKey != null ? (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-border bg-card px-2.5 py-1.5 shadow-sm"
            style={{
              bottom: H - (baseY - stacks.get(activeKey)! * (d + gap)) + 6,
              ...(x(activeKey / 2) > W / 2
                ? { right: `${((W - x(activeKey / 2) - 6) / W) * 100}%` }
                : { left: `${((x(activeKey / 2) - 6) / W) * 100}%` }),
            }}
          >
            <div className="num text-ui font-semibold text-ink">{fmt(activeKey / 2)}</div>
            <div className="whitespace-nowrap text-caption text-ink-soft">
              {stacks.get(activeKey)} {stacks.get(activeKey) === 1 ? 'speech' : 'speeches'}
            </div>
          </div>
        ) : null}
      </div>

      {/* A key, not labels in the plot: "middle 50%" collided with the
          median's label whenever the two sat close. */}
      <ul className="mt-hair flex gap-stack text-caption text-ink-soft" aria-hidden>
        <li className="inline-flex items-center gap-hair">
          <span className="h-3 w-4 rounded-[2px] bg-score-blue/10" />
          Middle 50%
        </li>
        <li className="inline-flex items-center gap-hair">
          <span className="h-3 w-px bg-foreground/60" />
          Median
        </li>
      </ul>

      <details className="mt-2" data-print-hide="true">
        <summary
          className={cn(
            'cursor-pointer py-1 text-caption text-ink-soft hover:text-ink coarse:py-2',
          )}
        >
          Show the figures as a table
        </summary>
        <div className="mt-2 max-w-xs">
          <Table label={title}>
            <thead>
              <tr>
                <Th numeric>Score</Th>
                <Th numeric>Speeches</Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <Td numeric>{fmt(k / 2)}</Td>
                  <Td numeric>{stacks.get(k)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
    </div>
  );
}
