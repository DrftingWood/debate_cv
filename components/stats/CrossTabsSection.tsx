'use client';

/**
 * Cross-tabs on /cv/stats: two dimensions at once, with the cells that stand
 * out stated as findings above the grid. The figures come from
 * lib/cv/crossTabs.ts over the round table the page has already filtered.
 *
 * The metric toggle defaults to the speaker-average delta because it is the
 * only figure that compares fairly across formats. Win rate is offered as a
 * delta for the same reason (a raw BP win rate next to a raw two-team one
 * reads as a gap that is really the format). Team points are BP-only, so that
 * option appears only when some visible cell has them.
 */

import { useMemo, useState } from 'react';
import type { RoundFact, StatsFacts } from '@/lib/cv/statsFacts';
import {
  cellKey,
  crossTab,
  crossTabFindings,
  seatName,
  type CrossTab,
  type CrossTabCell,
  type CrossTabDimension,
} from '@/lib/cv/crossTabs';
import { MIN_SPLIT_ROUNDS } from '@/lib/cv/roundSplits';
import { SectionHeader } from '@/components/ui/Card';
import { Table, Th, Td, Tr, TableScroll } from '@/components/ui/DataTable';
import { cn } from '@/lib/utils/cn';
import { PressedMark, pressedClasses } from '@/components/stats/pressed';
import { deltaTone, signed } from '@/components/stats/format';

type Metric = 'score' | 'win' | 'points';

const GRIDS: Array<{ id: string; label: string; rows: CrossTabDimension; cols: CrossTabDimension }> = [
  { id: 'seat-type', label: 'Seat × motion type', rows: 'seat', cols: 'motionType' },
  { id: 'pairing-type', label: 'Pairing × motion type', rows: 'pairing', cols: 'motionType' },
  { id: 'seat-pairing', label: 'Seat × pairing', rows: 'seat', cols: 'pairing' },
];

const METRICS: Array<{ id: Metric; label: string }> = [
  { id: 'score', label: 'Speaker avg vs you' },
  // BP rounds are never "wins": for them this is the 2nd-or-better rate.
  { id: 'win', label: 'Win / 2nd-or-better rate vs you' },
  { id: 'points', label: 'Team points' },
];

const PAIRING_LABEL: Record<string, string> = { pro: 'As the pro', am: 'As the am', peers: 'With peers' };

function keyLabel(dimension: CrossTabDimension, key: string, multiFormat: boolean) {
  if (dimension === 'pairing') return PAIRING_LABEL[key] ?? key;
  if (dimension === 'seat') return multiFormat ? key.replace(':', ' · ') : seatName(key);
  return key;
}

// Thin and empty cells are drawn in `ink-soft` at full strength. They were
// at /50 and /60 (about 2:1), with the round count only in a `title` — the
// sample size, which §9 says must be visible, was the faintest thing on the
// grid (SC 1.4.3, 1.4.13).
function CellValue({ cell, metric }: { cell: CrossTabCell | undefined; metric: Metric }) {
  if (!cell)
    return (
      <span className="text-ink-soft">
        <span aria-hidden>–</span>
        <span className="sr-only">No rounds</span>
      </span>
    );
  if (cell.hidden) {
    return (
      <span className="num whitespace-nowrap text-caption text-ink-soft">
        <span aria-hidden>· {cell.rounds} rds</span>
        <span className="sr-only">
          {cell.rounds} round{cell.rounds === 1 ? '' : 's'}, too few to show
        </span>
      </span>
    );
  }
  let value: number | null;
  let text: string | null;
  let flat: number;
  if (metric === 'score') {
    value = cell.scoreDelta;
    text = value == null ? null : signed(value, 1);
    flat = 0.3;
  } else if (metric === 'win') {
    value = cell.winRateDelta;
    text = value == null ? null : `${signed(value, 0)}pp`;
    flat = 5;
  } else {
    value = null;
    text = cell.avgPoints == null ? null : cell.avgPoints.toFixed(2);
    flat = Infinity;
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span
        className={cn(
          'num',
          value == null || Math.abs(value) < flat ? 'text-ink' : deltaTone(value, metric === 'win' ? 0 : 1),
        )}
      >
        {text ?? '—'}
      </span>
      <span className="num whitespace-nowrap text-caption text-ink-soft">
        {cell.rounds}
        <span aria-hidden> rds</span>
        <span className="sr-only"> rounds</span>
      </span>
    </span>
  );
}

function Grid({ tab, metric, label }: { tab: CrossTab; metric: Metric; label: string }) {
  const cellAt = new Map(tab.cells.map((c) => [cellKey(c.row, c.col), c]));
  const prefixes = (keys: string[]) => new Set(keys.map((k) => k.split(':')[0])).size > 1;
  const rowsMulti = tab.rowDimension === 'seat' && prefixes(tab.rows);
  const colsMulti = tab.colDimension === 'seat' && prefixes(tab.cols);

  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table className="min-w-max" label={label}>
          <thead>
            <tr>
              <Th className="pl-4">{tab.rowDimension === 'seat' ? 'Seat' : tab.rowDimension === 'pairing' ? 'Pairing' : 'Type'}</Th>
              {tab.cols.map((c, i) => (
                <Th key={c} numeric className={i === tab.cols.length - 1 ? 'pr-4' : undefined}>
                  {keyLabel(tab.colDimension, c, colsMulti)}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tab.rows.map((r) => (
              <Tr key={r}>
                <Td className="whitespace-nowrap pl-4 font-medium">{keyLabel(tab.rowDimension, r, rowsMulti)}</Td>
                {tab.cols.map((c, i) => (
                  <Td key={c} numeric className={i === tab.cols.length - 1 ? 'pr-4' : undefined}>
                    <CellValue cell={cellAt.get(cellKey(r, c))} metric={metric} />
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </div>
  );
}

function Toggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-table font-medium transition-colors coarse:min-h-[44px] coarse:py-0',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            pressedClasses(o.id === value),
          )}
        >
          {o.id === value ? <PressedMark /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CrossTabsSection({ facts, baseline }: { facts: StatsFacts; baseline: RoundFact[] }) {
  const tabs = useMemo(
    () =>
      GRIDS.map((g) => ({ ...g, tab: crossTab(facts.rounds, g.rows, g.cols, baseline) })).filter((g) =>
        g.tab.cells.some((c) => !c.hidden),
      ),
    [facts, baseline],
  );
  const findings = useMemo(() => crossTabFindings(tabs.map((t) => t.tab)), [tabs]);
  const [gridId, setGridId] = useState(GRIDS[0].id);
  const [metricChoice, setMetric] = useState<Metric>('score');

  if (tabs.length === 0) return null;
  const current = tabs.find((t) => t.id === gridId) ?? tabs[0];
  const hasPoints = current.tab.cells.some((c) => c.avgPoints != null);
  const metrics = METRICS.filter((m) => m.id !== 'points' || hasPoints);
  const metric = metrics.some((m) => m.id === metricChoice) ? metricChoice : 'score';

  return (
    <section id="cross-tabs" aria-label="Cross-tabs" className="scroll-mt-24 space-y-4">
      <SectionHeader
        label="Cross-tabs"
        title="Where two things meet"
        meta="Deltas compare with your whole record in the same format"
      />

      {findings.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {findings.map((q) => (
            <article key={q.id} className="panel p-4">
              <div className="flex items-start gap-2.5">
                <span aria-hidden className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', q.tone === 'pos' ? 'bg-pos' : 'bg-neg')} />
                <div className="min-w-0">
                  <p className="text-table text-ink">{q.text}</p>
                  <p className="mt-1.5 data-label">{q.basis}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {tabs.length > 1 ? (
          <Toggle label="Grid" options={tabs.map((t) => ({ id: t.id, label: t.label }))} value={current.id} onChange={setGridId} />
        ) : (
          <h3 className="font-display text-h4 font-medium text-ink">{current.label}</h3>
        )}
        <Toggle label="Metric" options={metrics} value={metric} onChange={setMetric} />
      </div>

      <Grid
        tab={current.tab}
        metric={metric}
        label={`${current.label}, ${metrics.find((m) => m.id === metric)?.label.toLowerCase() ?? ''}`}
      />

      <p className="text-caption text-ink-soft">
        Prelim rounds only. A cell with fewer than {MIN_SPLIT_ROUNDS} rounds, scored speeches or
        decided rounds shows a dot and its round count instead of a figure. Findings are the cells furthest from what their row and column predict on their own
        — at least 0.5 speaker points, across two or more tournaments — so a seat or a motion type
        that is simply strong everywhere shows up in Positions and Motion types, not here.
        Team points are British Parliamentary only.
      </p>
    </section>
  );
}
