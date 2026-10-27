'use client';

/**
 * Topic × motion class on /cv/stats: how your speaker score moves with what
 * the debate was about and how the motion was put, and, separately, how your
 * team fared in knockouts on each. The figures come from
 * lib/cv/statsHeatmap.ts over the round table the page has already filtered.
 *
 * "Class" is read from the motion's wording (Policy, Belief, Actor, ...), not
 * the THW/THBT stem tag shown on /cv/motions; the section says so, because a
 * reader who sees "type" next to a stem tag elsewhere would take them for one
 * thing.
 *
 * The section explains its own blanks: it says how many scored rounds have a
 * topic and a class, where the rest went, and what the sample gate is. It
 * used to render nothing until a cell cleared the gate, which on a real
 * record read as "this feature is broken" rather than "not enough rounds yet".
 */

import { useMemo } from 'react';
import type { KnockoutFact, StatsFacts } from '@/lib/cv/statsFacts';
import {
  knockoutRecord,
  topicTypeHeatmap,
  type HeatCoverage,
  type HeatCell,
  type KnockoutLine,
  type MixedBucket,
  type TopicTypeHeatmap,
} from '@/lib/cv/statsHeatmap';
import { MIN_QUIRK_ROUNDS } from '@/lib/cv/speakerStats';
import { SectionHeader } from '@/components/ui/Card';
import { Table, Th, Td, Tr, TableScroll } from '@/components/ui/DataTable';
import { cn } from '@/lib/utils/cn';

const signed = (n: number) => {
  const r = Number(n.toFixed(1));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function CellValue({ cell }: { cell: HeatCell | MixedBucket | undefined }) {
  if (!cell)
    return (
      <span className="text-ink-soft">
        <span aria-hidden>–</span>
        <span className="sr-only">No rounds</span>
      </span>
    );
  if (!cell.enough) {
    return (
      <span className="num whitespace-nowrap text-caption text-ink-soft">
        <span aria-hidden>· {cell.rounds} rds</span>
        <span className="sr-only">
          {cell.rounds} round{cell.rounds === 1 ? '' : 's'}, too few to show
        </span>
      </span>
    );
  }
  const delta = cell.scoreDelta;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span
        className={cn(
          'num',
          delta == null || Math.abs(delta) < 0.3 ? 'text-ink' : delta > 0 ? 'val-pos' : 'val-neg',
        )}
      >
        {delta == null ? '—' : signed(delta)}
      </span>
      <span className="num text-caption text-ink-soft">
        {cell.rounds}
        <span aria-hidden> rds</span>
        <span className="sr-only"> rounds</span>
      </span>
    </span>
  );
}

/** Where the scored rounds outside the grid went, in words. Empty when every round is in a cell. */
function coverageNote(c: HeatCoverage): string {
  const parts = [
    c.noMotion > 0 ? `${plural(c.noMotion, 'round')} with no motion on record` : null,
    c.choice > 0 ? `${plural(c.choice, 'choice round')} (options differ)` : null,
    c.untagged > 0 ? `${plural(c.untagged, 'round')} with an untagged motion` : null,
    c.unclassified > 0
      ? `${plural(c.unclassified, 'round')} whose wording the classifier can't place`
      : null,
  ].filter(Boolean);
  return parts.length === 0 ? '' : `Not in a cell: ${parts.join(', ')}.`;
}

/** Knockouts from the tournaments the filter kept. */
function knockoutsIn(facts: StatsFacts): KnockoutFact[] {
  const kept = new Set(facts.tournaments.map((t) => t.tournamentId));
  return (facts.knockouts ?? []).filter((k) => kept.has(k.tournamentId));
}

function KnockoutTable({ label, rows }: { label: string; rows: KnockoutLine[] }) {
  return (
    <div className="panel overflow-hidden">
      <Table label={`Knockout results by ${label.toLowerCase()}`}>
        <thead>
          <tr>
            <Th className="pl-4">{label}</Th>
            <Th numeric>Through</Th>
            <Th numeric className="pr-4">
              Out
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.key}>
              <Td className="whitespace-nowrap pl-4 font-medium">{r.key}</Td>
              <Td numeric>{r.won}</Td>
              <Td numeric className="pr-4">
                {r.lost}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function KnockoutView({ knockouts }: { knockouts: KnockoutFact[] }) {
  const ko = useMemo(() => knockoutRecord(knockouts), [knockouts]);
  if (ko.rounds === 0) return null;
  const gaps = [
    ko.noMotion > 0 ? `${plural(ko.noMotion, 'stage')} with no motion on record` : null,
    ko.noTopic > 0 ? `${plural(ko.noTopic, 'stage')} without a single known topic` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3">
      <div>
        <div className="data-label">Knockouts</div>
        <p className="mt-1 text-caption text-ink-soft">
          Outround speaker scores are not published, so knockouts are counted by your team&rsquo;s
          result instead: {plural(ko.rounds, 'knockout round')}, {ko.won} through (advanced or won
          the final), {ko.lost} out.
          {gaps.length > 0 ? ` Not in the tables: ${gaps.join(', ')}.` : ''}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {ko.byTopic.length > 0 ? <KnockoutTable label="Topic" rows={ko.byTopic} /> : null}
        {ko.byType.length > 0 ? <KnockoutTable label="Class" rows={ko.byType} /> : null}
      </div>
      {ko.choice ? (
        <p className="text-caption text-ink-soft">
          Choice of motions (options differ): {ko.choice.won} through, {ko.choice.lost} out.
        </p>
      ) : null}
    </div>
  );
}

function BelowGate() {
  return (
    <p className="panel px-4 py-3 text-caption text-ink-soft">
      No topic, class or pairing of the two has reached {MIN_QUIRK_ROUNDS} scored rounds yet, so no
      figure is shown.
    </p>
  );
}

/** The score grid with its margins, or a line saying nothing has cleared the gate yet. */
function ScoreGrid({ grid }: { grid: TopicTypeHeatmap }) {
  const cellAt = new Map(grid.cells.map((c) => [`${c.topic}\u0000${c.type}`, c]));
  const anyFigure = [...grid.cells, ...grid.topicTotals, ...grid.typeTotals, grid.mixed].some(
    (c) => c?.enough,
  );
  if (!anyFigure) return <BelowGate />;
  return (
    <div className="panel overflow-hidden">
      <TableScroll>
        <Table
          className="min-w-max"
          label="Speaker score against your average, by motion topic and motion class"
        >
          <thead>
            <tr>
              <Th className="pl-4">Topic</Th>
              {grid.types.map((t) => (
                <Th key={t} numeric>
                  {t}
                </Th>
              ))}
              <Th numeric className="pr-4">
                All classes
              </Th>
            </tr>
          </thead>
          <tbody>
            {grid.topics.map((topic, row) => (
              <Tr key={topic}>
                <Td rowHeader className="whitespace-nowrap pl-4 font-medium">
                  {topic}
                </Td>
                {grid.types.map((type) => (
                  <Td key={type} numeric>
                    <CellValue cell={cellAt.get(`${topic}\u0000${type}`)} />
                  </Td>
                ))}
                <Td numeric className="pr-4">
                  <CellValue cell={grid.topicTotals[row]} />
                </Td>
              </Tr>
            ))}
            <Tr>
              <Td className="whitespace-nowrap pl-4 font-medium">All topics</Td>
              {grid.typeTotals.map((c) => (
                <Td key={c.key} numeric>
                  <CellValue cell={c} />
                </Td>
              ))}
              <Td numeric className="pr-4" />
            </Tr>
          </tbody>
        </Table>
      </TableScroll>
    </div>
  );
}

export function TopicTypeSection({
  facts,
  knockoutsWithheld = false,
}: {
  facts: StatsFacts;
  /** A seat filter is on: knockouts have no seat, so they are left out and the section says why. */
  knockoutsWithheld?: boolean;
}) {
  const grid = useMemo(() => topicTypeHeatmap(facts.rounds), [facts]);
  const knockouts = useMemo(
    () => (knockoutsWithheld ? [] : knockoutsIn(facts)),
    [facts, knockoutsWithheld],
  );
  // Nothing to explain on a record with no motions at all: the Motions page
  // already says why. Any motion on record and the section shows, gaps named.
  const withMotion = grid.scoredRounds - grid.coverage.noMotion;
  if (withMotion === 0 && knockouts.length === 0) return null;

  const note = coverageNote(grid.coverage);

  return (
    <section id="topic-types" aria-label="Topic by motion class" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Topic × motion class"
        title="What the debate was about, and how it was put"
        meta={`${grid.coverage.covered} of ${grid.scoredRounds} scored prelim rounds have both a topic and a class`}
      />
      {note ? <p className="text-caption text-ink-soft">{note}</p> : null}
      {grid.scoredRounds > 0 ? <ScoreGrid grid={grid} /> : null}
      {grid.mixed ? (
        <div className="panel flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="font-medium text-ink">Choice of motions</div>
            <div className="text-caption text-ink-soft">
              Rounds that released several motions of different topics or classes (Asian
              Parliamentary's three), clubbed together because the motion debated is not recorded.
            </div>
          </div>
          <CellValue cell={grid.mixed} />
        </div>
      ) : null}
      {grid.scoredRounds > 0 ? (
        <p className="text-caption text-ink-soft">
          Speaker-score difference from your mean over these rounds, prelims only. A figure needs at
          least {MIN_QUIRK_ROUNDS} rounds behind it, the minimum this page uses before naming any
          pattern, because over fewer one unusual round can swing the mean; below that a cell shows
          a dot. &ldquo;All classes&rdquo; and &ldquo;All topics&rdquo; also count rounds whose
          other side is unknown. Topics are the community tags. Class is read from the wording:
          Policy (THW), Belief (THBT), Stance (THS, THO), Regret (THR), Preference (THP), Actor
          (&ldquo;TH, as X, would&rdquo;). It is not the stem tag on the Motions page.
        </p>
      ) : null}
      {knockoutsWithheld && (facts.knockouts?.length ?? 0) > 0 ? (
        <p className="text-caption text-ink-soft">
          Knockout results are facts about a team&rsquo;s run, not a seat, so they aren&rsquo;t
          shown while filtering by seat.
        </p>
      ) : (
        <KnockoutView knockouts={knockouts} />
      )}
    </section>
  );
}
