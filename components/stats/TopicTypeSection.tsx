'use client';

/**
 * Topic × motion type on /cv/stats: how your speaker score moves with what
 * the debate was about and how the motion was phrased. The figures come from
 * lib/cv/statsHeatmap.ts over the round table the page has already filtered.
 *
 * Only rounds whose motion has an approved topic AND a classified type are in
 * the grid, so the section says how many of the scored rounds that is. A cell
 * under the sample gate shows a dot and its round count, never a figure.
 */

import { useMemo } from 'react';
import type { StatsFacts } from '@/lib/cv/statsFacts';
import { topicTypeHeatmap, type HeatCell } from '@/lib/cv/statsHeatmap';
import { MIN_QUIRK_ROUNDS } from '@/lib/cv/speakerStats';
import { SectionHeader } from '@/components/ui/Card';
import { Table, Th, Td, Tr, TableScroll } from '@/components/ui/DataTable';
import { cn } from '@/lib/utils/cn';

const signed = (n: number) => {
  const r = Number(n.toFixed(1));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`;
};

function CellValue({ cell }: { cell: HeatCell | undefined }) {
  if (!cell)
    return (
      <span className="text-ink-soft/50">
        <span aria-hidden>–</span>
        <span className="sr-only">No rounds</span>
      </span>
    );
  if (!cell.enough) {
    return (
      <span
        className="text-ink-soft/60"
        title={`${cell.rounds} round${cell.rounds === 1 ? '' : 's'} — too few to show`}
      >
        <span aria-hidden>·</span>
        <span className="sr-only">{cell.rounds} rounds, too few to show</span>
      </span>
    );
  }
  const delta = cell.scoreDelta;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={cn('num', delta == null || Math.abs(delta) < 0.3 ? 'text-ink' : delta > 0 ? 'val-pos' : 'val-neg')}>
        {delta == null ? '—' : signed(delta)}
      </span>
      <span className="num text-caption text-ink-soft">
        {cell.rounds}
        <span aria-hidden>r</span>
        <span className="sr-only"> rounds</span>
      </span>
    </span>
  );
}

export function TopicTypeSection({ facts }: { facts: StatsFacts }) {
  const grid = useMemo(() => topicTypeHeatmap(facts.rounds), [facts]);
  // Nothing to say until at least one cell clears the gate.
  if (!grid.cells.some((c) => c.enough)) return null;

  const cellAt = new Map(grid.cells.map((c) => [`${c.topic}\u0000${c.type}`, c]));

  return (
    <section id="topic-types" aria-label="Topic by motion type" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Topic × type"
        title="What the debate was about, and how it was put"
        meta={`${grid.coveredRounds} of ${grid.scoredRounds} scored prelim rounds have both a topic and a type`}
      />
      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="min-w-max" label="Speaker score against your average, by motion topic and motion type">
            <thead>
              <tr>
                <Th className="pl-4">Topic</Th>
                {grid.types.map((t, i) => (
                  <Th key={t} numeric className={i === grid.types.length - 1 ? 'pr-4' : undefined}>
                    {t}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.topics.map((topic) => (
                <Tr key={topic}>
                  <Td className="whitespace-nowrap pl-4 font-medium">{topic}</Td>
                  {grid.types.map((type, i) => (
                    <Td key={type} numeric className={i === grid.types.length - 1 ? 'pr-4' : undefined}>
                      <CellValue cell={cellAt.get(`${topic}\u0000${type}`)} />
                    </Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
      <p className="text-caption text-ink-soft">
        Speaker-score difference from your mean over these rounds, prelims only. A cell with fewer than{' '}
        {MIN_QUIRK_ROUNDS} rounds shows a dot instead of a figure. Topics are the community tags; rounds whose motion
        is untagged, or whose options disagree on topic or type, are left out.
      </p>
    </section>
  );
}
