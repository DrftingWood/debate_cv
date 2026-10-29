import * as React from 'react';
import { ArrowSquareOut, CaretDown } from '@/components/ui/icons';
import type { JudgingYearTotal, RecordYear, SpeakingYearTotal } from '@/lib/cv/periodTotal';
import { cn } from '@/lib/utils/cn';
import { DetailsBody } from '@/components/ui/Deferred';

/*
 * The year groups shared by the Record (/cv) and the public CV (/u/<slug>):
 * each calendar year a native <details> whose <summary> is its subtotal row
 * (redesign owner decisions 14-16, 2026-10-29), plus the Source cell both
 * ledgers end with. The two pages differ only in the table inside a year:
 * the owner's carries report buttons and round detail, the public one
 * neither, so each passes its own `table`.
 *
 * Ids are `y2025` (speaking) and `j2025` (judging): what a career-chart bar
 * links to, and what OpenYearOnHash opens.
 */

/**
 * The Source cell: the tab's host in mono with ↗, linked to the public tab
 * page. `sourceUrl` is already the public page (publicTournamentUrl strips a
 * private-URL path to the tournament root), so a private link never shows.
 * An empty one reads as a muted "private", with no link.
 */
export function SourceLink({ href }: { href: string }) {
  let host: string | null = null;
  try {
    host = href ? new URL(href).host : null;
  } catch {
    host = null;
  }
  if (!host) return <span className="text-caption text-ink-soft">private</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-6 items-center gap-1 font-mono text-caption text-ink-soft hover:text-primary coarse:min-h-[44px]"
    >
      {host}
      <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}

function yearLabel(year: number | null): string {
  return year == null ? 'Undated' : String(year);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "5 tournaments · broke 2 · best Semifinals · median top 24% (n=4)". */
function speakingSubtotal(t: SpeakingYearTotal): string {
  return [
    plural(t.tournaments, 'tournament'),
    `broke ${t.broke}`,
    t.bestResult ? `best ${t.bestResult}` : null,
    t.medianTeamPlace ? `median ${t.medianTeamPlace.label} (n=${t.medianTeamPlace.n})` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "judged 3 · broke at 2 · chaired outrounds at 1 · core at 1". */
function judgingSubtotal(t: JudgingYearTotal): string {
  return [
    `judged ${t.tournaments}`,
    t.outrounds ? `broke at ${t.outrounds}` : null,
    t.chaired ? `chaired outrounds at ${t.chaired}` : null,
    t.core ? `core at ${t.core}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * One year of the statement. The summary carries the year and its subtotal
 * (PeriodTotal, the design's signature row: the ledger's top rule and
 * semibold mono), so the folded year is still a line you can read.
 */
function YearGroup({
  id,
  year,
  open,
  lines,
  children,
}: {
  id: string;
  year: number | null;
  open: boolean;
  /** The subtotal, first line most important. */
  lines: string[];
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className="group/year scroll-mt-24 border-t border-ink">
      {/* One left edge (owner review 2026-10-29): the year sits flush with
          the rule above and the table below, and its caret follows it
          rather than pushing it 22 px in. */}
      {/* A folded year was 93 px: three mono lines pushed to the far right,
          1,400 px from the year they describe (owner review 2026-10-29).
          Now the subtotal sits beside the year in at most two lines. */}
      <summary className="flex cursor-pointer select-none items-start py-inline coarse:min-h-[44px]">
        <span className="grid min-w-0 flex-1 gap-x-panel gap-y-hair md:grid-cols-[6.5rem_minmax(0,1fr)] md:items-baseline">
          {/* Not a heading element: a heading inside <summary> loses its
              role in some screen readers, as the summary is a button. */}
          <span className="inline-flex items-center gap-inline font-display text-h3 font-medium text-ink">
            {yearLabel(year)}
            <CaretDown
              className="h-3.5 w-3.5 shrink-0 -rotate-90 text-primary transition-transform duration-180 group-open/year:rotate-0 motion-reduce:transition-none"
              aria-hidden
            />
          </span>
          <span className="block font-mono text-caption text-ink-soft">
            {lines.map((l, i) => (
              <span key={i} className={cn('block', i === 0 && 'font-semibold text-ink')}>
                {l}
              </span>
            ))}
          </span>
        </span>
      </summary>
      <div className="pb-panel">
        <DetailsBody initiallyOpen={open}>{children}</DetailsBody>
      </div>
    </details>
  );
}

function speakingLines(y: RecordYear): string[] {
  const t = y.speakingTotal;
  if (!t) return [];
  // Two lines: the team's year, then the user's own speaking and judging.
  const second = [
    t.speakerAverage
      ? `speaker average ${t.speakerAverage.value.toFixed(1)} over ${plural(t.speakerAverage.speeches, 'speech', 'speeches')}`
      : null,
    y.judgingTotal ? judgingSubtotal(y.judgingTotal) : null,
  ].filter((l): l is string => l !== null);
  return [speakingSubtotal(t), ...(second.length ? [second.join(' · ')] : [])];
}

/** Speaking, year by year, with the judging line on each subtotal. */
export function SpeakingYears({
  years,
  open,
  table,
}: {
  years: RecordYear[];
  open: Set<number>;
  table: (y: RecordYear, label: string) => React.ReactNode;
}) {
  return (
    <div>
      {years.map((y) =>
        y.speakingTotal ? (
          <YearGroup
            key={yearLabel(y.year)}
            id={`y${y.year ?? 'undated'}`}
            year={y.year}
            open={y.year != null && open.has(y.year)}
            lines={speakingLines(y)}
          >
            {table(y, `Speaking record, ${yearLabel(y.year)}`)}
          </YearGroup>
        ) : null,
      )}
      <div className="border-t border-ink" />
    </div>
  );
}

/** Judging, year by year. */
export function JudgingYears({
  years,
  open,
  table,
}: {
  years: RecordYear[];
  open: Set<number>;
  table: (y: RecordYear, label: string) => React.ReactNode;
}) {
  return (
    <div>
      {years.map((y) =>
        y.judgingTotal ? (
          <YearGroup
            key={yearLabel(y.year)}
            id={`j${y.year ?? 'undated'}`}
            year={y.year}
            open={y.year != null && open.has(y.year)}
            lines={[judgingSubtotal(y.judgingTotal)]}
          >
            {table(y, `Judging record, ${yearLabel(y.year)}`)}
          </YearGroup>
        ) : null,
      )}
      <div className="border-t border-ink" />
    </div>
  );
}
