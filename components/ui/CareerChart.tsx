'use client';

import { useId, useRef, useState } from 'react';
import { Star } from '@/components/ui/icons';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import type { CareerSeries, CareerYear } from '@/lib/cv/careerChart';
import { cn } from '@/lib/utils/cn';

/*
 * One career chart: a stacked bar per calendar year, one cell per tournament,
 * bottom to top by how far the user got (owner decisions 2026-10-29). The
 * model is `speakingSeries` / `judgingSeries` in lib/cv/careerChart.ts; this
 * file only draws it.
 *
 * Reading it:
 *   - bar height is the number of tournaments that year, scaled to the
 *     busiest year, so a busy year looks busy;
 *   - grey cells sit below an ink rule (no break / no outround); above it
 *     the blue ramp, then gold for a title (speaking) or a chaired final
 *     (judging), then purple for an adjudication-core role;
 *   - a major's cell has a heavy ink outline and a ◆ notch, so a semifinal
 *     at a major still reads as a semifinal; the year label carries ◆n;
 *   - the star above a bar grows with the count (area, not radius):
 *     top-10 speaker finishes when speaking, outrounds chaired when judging.
 *
 * Interaction (UX-36: nothing needed lives only on hover): hovering or
 * focusing a year fills the details strip under the legend (last, so its
 * changing height moves nothing but the table toggle); on touch the
 * first tap fills it and the strip carries the "Go to <year>" link, the
 * second tap follows it. A bar is a link to that year in the ledger. The
 * full numbers are also in the "See the numbers" table (UX-32).
 *
 * Motion: bars grow once from the baseline on first render, at most 700 ms
 * including the stagger, and not at all under reduced motion. Nothing loops,
 * so no pause control is needed (SC 2.2.2).
 */

type Tier = { key: string; label: string; swatch: string };

const SPEAKING: Tier[] = [
  { key: 'none', label: 'Did not break', swatch: 'bg-tier-none' },
  { key: 'qf', label: 'Quarters and below', swatch: 'bg-tier-qf' },
  { key: 'sf', label: 'Semifinals', swatch: 'bg-tier-sf' },
  { key: 'f', label: 'Finals', swatch: 'bg-tier-f' },
  { key: 'champion', label: 'Champion', swatch: 'bg-break-gold' },
];

const JUDGING: Tier[] = [
  { key: 'none', label: 'No outround', swatch: 'bg-tier-none' },
  { key: 'qf', label: 'Quarters and below', swatch: 'bg-tier-qf' },
  { key: 'sf', label: 'Semifinals', swatch: 'bg-tier-sf' },
  { key: 'f', label: 'Final', swatch: 'bg-tier-f' },
  { key: 'chairedFinal', label: 'Chaired the final', swatch: 'bg-break-gold' },
  { key: 'core', label: 'Adjudication core', swatch: 'bg-core-purple' },
];

const STAR_NOUN = {
  speaking: ['top-10 speaker finish', 'top-10 speaker finishes'],
  judging: ['outround chaired', 'outrounds chaired'],
} as const;

/** Star size grows with the square root of the count (its area tracks n). */
function starSize(n: number): number {
  return Math.min(26, Math.round(8 + 7 * Math.sqrt(n)));
}

function plural(n: number, [one, many]: readonly [string, string]) {
  return `${n} ${n === 1 ? one : many}`;
}

export function CareerChart({
  kind,
  title,
  series,
  yearHref = (year) => `#y${year}`,
  compact = false,
}: {
  kind: 'speaking' | 'judging';
  title: string;
  series: CareerSeries<string>;
  /** Where a year's bar links to; null to render bars without links. */
  yearHref?: ((year: number) => string) | null;
  /** Static: no stars, links, details or table (the landing sample). */
  compact?: boolean;
}) {
  const tiers = kind === 'speaking' ? SPEAKING : JUDGING;
  const tierOf = (key: string) => tiers.find((t) => t.key === key) ?? tiers[0];
  const max = Math.max(1, ...series.years.map((y) => y.cells.length));
  const [active, setActive] = useState<number | null>(null);
  // A ref, not state: the click that follows a tap fires before a state
  // update from its own pointerdown would have re-rendered.
  const touch = useRef(false);
  const titleId = useId();
  const activeYear = series.years.find((y) => y.year === active) ?? null;

  const describe = (y: CareerYear<string>) => {
    const counts = tiers
      .map((t) => ({ t, n: y.cells.filter((c) => c.tier === t.key).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.n} ${x.t.label.toLowerCase()}`);
    const majors = y.cells.filter((c) => c.major).length;
    return [
      `${y.year}: ${plural(y.cells.length, ['tournament', 'tournaments'])}`,
      ...counts,
      ...(majors ? [plural(majors, ['major', 'majors'])] : []),
      ...(y.stars.length ? [plural(y.stars.length, STAR_NOUN[kind])] : []),
    ].join(', ');
  };

  if (series.years.length === 0) return null;

  return (
    <figure aria-labelledby={titleId} className="panel min-w-0 p-stack md:p-panel">
      <figcaption id={titleId} className="data-label">
        {title}
      </figcaption>

      <div
        className={cn('mt-stack flex items-end gap-hair', compact ? 'h-28' : 'h-44 md:h-52')}
        onPointerLeave={() => !touch.current && setActive(null)}
      >
        {series.years.map((y, i) => {
          const n = y.cells.length;
          const bar = <Bar year={y} index={i} max={max} compact={compact} tierOf={tierOf} />;
          const column = 'flex h-full min-w-0 flex-1 flex-col items-center';
          if (compact || n === 0 || !yearHref) {
            return (
              <div key={y.year} className={column} aria-hidden={compact || n === 0}>
                {bar}
              </div>
            );
          }
          return (
            <a
              key={y.year}
              href={yearHref(y.year)}
              aria-label={`${describe(y)}. Go to ${y.year}.`}
              className={cn(
                column,
                'rounded-sm outline-offset-2',
                active === y.year && 'bg-surface-2',
              )}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(y.year)}
              onPointerDown={(e) => {
                touch.current = e.pointerType !== 'mouse';
              }}
              // Keyboard focus only: a tap focuses the link before its click, and
              // must not count as the first tap having happened already.
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && setActive(y.year)}
              onClick={(e) => {
                // First tap on a phone shows the details; the strip's link
                // (or a second tap) goes to the year.
                if (touch.current && active !== y.year) {
                  e.preventDefault();
                  setActive(y.year);
                }
              }}
            >
              {bar}
            </a>
          );
        })}
      </div>

      <YearLabels years={series.years} />
      <Legend tiers={tiers} kind={kind} compact={compact} />

      {!compact ? (
        <div className="panel-inset mt-stack min-h-24 p-tight text-caption">
          {activeYear ? (
            <YearDetails year={activeYear} kind={kind} tierOf={tierOf} yearHref={yearHref} />
          ) : (
            <p className="text-ink-soft">Hover, focus or tap a year for its tournaments.</p>
          )}
        </div>
      ) : null}

      {compact ? (
        // The bars are hidden from assistive tech in this static form, so
        // the figure says in words what they show (UX-32).
        <p className="sr-only">{summary(series, kind)}</p>
      ) : null}

      {series.undated > 0 ? (
        <p className="mt-hair text-caption text-ink-soft">
          {plural(series.undated, ['tournament has', 'tournaments have'])} no date and{' '}
          {series.undated === 1 ? 'is' : 'are'} not shown.
        </p>
      ) : null}

      {!compact ? <NumbersTable title={title} series={series} tiers={tiers} kind={kind} /> : null}
    </figure>
  );
}

function Bar({
  year,
  index,
  max,
  compact,
  tierOf,
}: {
  year: CareerYear<string>;
  index: number;
  max: number;
  compact: boolean;
  tierOf: (key: string) => Tier;
}) {
  const noneCount = year.cells.filter((c) => c.tier === 'none').length;
  return (
    <>
      {!compact ? (
        <span className="flex h-8 shrink-0 items-end justify-center" aria-hidden>
          {year.stars.length > 0 ? (
            <Star weight="fill" className="text-break-gold" size={starSize(year.stars.length)} />
          ) : null}
        </span>
      ) : null}
      <span className="flex w-full min-h-0 flex-1 items-end justify-center" aria-hidden>
        <span
          className="flex w-full max-w-12 origin-bottom flex-col-reverse gap-px motion-safe:animate-grow-up"
          style={{
            height: `${(year.cells.length / max) * 100}%`,
            animationDelay: `${Math.min(index * 40, 200)}ms`,
          }}
        >
          {year.cells.map((c, j) => (
            <span key={j} className="contents">
              {/* The ink rule: the break line, between the grey cells and the rest. */}
              {j === noneCount && noneCount > 0 ? (
                <span className="h-0.5 shrink-0 bg-foreground" />
              ) : null}
              <span
                className={cn(
                  'relative min-h-0.5 flex-1 rounded-[1px]',
                  tierOf(c.tier).swatch,
                  c.major && 'ring-2 ring-inset ring-foreground',
                )}
              >
                {c.major ? (
                  <span className="absolute -left-1 top-1/2 size-1.5 -translate-y-1/2 rotate-45 bg-foreground" />
                ) : null}
              </span>
            </span>
          ))}
        </span>
      </span>
    </>
  );
}

function YearLabels({ years }: { years: CareerYear<string>[] }) {
  return (
    <div className="mt-hair flex gap-hair border-t border-foreground pt-hair" aria-hidden>
      {years.map((y) => {
        const majors = y.cells.filter((c) => c.major).length;
        return (
          <span key={y.year} className="min-w-0 flex-1 text-center font-mono text-caption">
            {/* Full year from sm up; the two-digit form keeps a long career
                legible on a phone. */}
            <span className="block text-ink">
              <span className="hidden sm:inline">{y.year}</span>
              <span className="sm:hidden">{`'${String(y.year).slice(2)}`}</span>
            </span>
            {majors > 0 ? <span className="block text-ink-soft">◆{majors}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function Legend({
  tiers,
  kind,
  compact,
}: {
  tiers: Tier[];
  kind: 'speaking' | 'judging';
  compact: boolean;
}) {
  return (
    <ul className="mt-stack flex flex-wrap gap-x-stack gap-y-hair text-caption text-ink-soft">
      {tiers.map((t) => (
        <li key={t.key} className="inline-flex items-center gap-hair">
          <span className={cn('size-3 rounded-[1px]', t.swatch)} aria-hidden />
          {t.label}
        </li>
      ))}
      <li className="inline-flex items-center gap-hair">
        <span className="size-3 rounded-[1px] ring-2 ring-inset ring-foreground" aria-hidden />
        Major (◆)
      </li>
      {!compact ? (
        <li className="inline-flex items-center gap-hair">
          <Star weight="fill" className="text-break-gold" size={12} aria-hidden />
          {capitalised(STAR_NOUN[kind][1])}
        </li>
      ) : null}
    </ul>
  );
}

function capitalised(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

function summary(series: CareerSeries<string>, kind: 'speaking' | 'judging'): string {
  const cells = series.years.flatMap((y) => y.cells);
  const above = cells.filter((c) => c.tier !== 'none').length;
  const first = series.years[0].year;
  const last = series.years[series.years.length - 1].year;
  const what = kind === 'speaking' ? 'with a break' : 'with an outround or a core role';
  return `${plural(cells.length, ['tournament', 'tournaments'])} from ${first} to ${last}, ${above} ${what}.`;
}

function YearDetails({
  year,
  kind,
  tierOf,
  yearHref,
}: {
  year: CareerYear<string>;
  kind: 'speaking' | 'judging';
  tierOf: (key: string) => Tier;
  yearHref: ((year: number) => string) | null;
}) {
  // Top of the bar first, majors first within a tier, as the eye reads it.
  const cells = [...year.cells].reverse();
  return (
    <div>
      <p className="flex flex-wrap items-baseline justify-between gap-inline">
        <span className="font-medium text-ink">
          {year.year} · {plural(year.cells.length, ['tournament', 'tournaments'])}
        </span>
        {yearHref && year.cells.length > 0 ? (
          <a href={yearHref(year.year)} className="text-primary underline-offset-2 hover:underline">
            Go to {year.year} ↓
          </a>
        ) : null}
      </p>
      <ul className="mt-hair grid gap-x-stack gap-y-px sm:grid-cols-2">
        {cells.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-hair">
            <span
              className={cn('size-2.5 shrink-0 rounded-[1px]', tierOf(c.tier).swatch)}
              aria-hidden
            />
            <span className="min-w-0 wrap-break-word text-ink">
              {c.major ? '◆ ' : ''}
              {c.tournamentName}
            </span>
            <span className="shrink-0 text-ink-soft">{c.detail}</span>
          </li>
        ))}
      </ul>
      {year.stars.length > 0 ? (
        <p className="mt-hair text-ink-soft">
          <span className="text-ink">★ {plural(year.stars.length, STAR_NOUN[kind])}:</span>{' '}
          {year.stars.map((s) => `${s.tournamentName} (${s.detail})`).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

function NumbersTable({
  title,
  series,
  tiers,
  kind,
}: {
  title: string;
  series: CareerSeries<string>;
  tiers: Tier[];
  kind: 'speaking' | 'judging';
}) {
  return (
    <details className="mt-stack">
      <summary className="inline-flex min-h-6 cursor-pointer items-center text-caption font-medium text-primary">
        See the numbers
      </summary>
      <TableScroll className="mt-tight">
        <Table label={`${title}, in numbers`}>
          <thead>
            <tr>
              <Th>Year</Th>
              <Th numeric>Tournaments</Th>
              {tiers.map((t) => (
                <Th key={t.key} numeric>
                  {t.label}
                </Th>
              ))}
              <Th numeric>Majors</Th>
              <Th numeric>{capitalised(STAR_NOUN[kind][1])}</Th>
            </tr>
          </thead>
          <tbody>
            {series.years.map((y) => (
              <Tr key={y.year}>
                <Td rowHeader className="font-mono">
                  {y.year}
                </Td>
                <Td numeric>{y.cells.length}</Td>
                {tiers.map((t) => (
                  <Td key={t.key} numeric>
                    {y.cells.filter((c) => c.tier === t.key).length}
                  </Td>
                ))}
                <Td numeric>{y.cells.filter((c) => c.major).length}</Td>
                <Td numeric>{y.stars.length}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </details>
  );
}
