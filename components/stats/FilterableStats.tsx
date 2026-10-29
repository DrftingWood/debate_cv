'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SlidersHorizontal } from '@/components/ui/icons';
import type { CvData } from '@/lib/cv/buildCvData';
import { computeSpeakerStats } from '@/lib/cv/speakerStats';
import type { StatsFacts } from '@/lib/cv/statsFacts';
import {
  filterCvData,
  filterFacts,
  isFilterActive,
  parseStatsFilter,
  serializeStatsFilter,
  visibleQuirkIds,
  type StatsFilter,
} from '@/lib/cv/statsFilter';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs } from '@/components/ui/Tabs';
import { StatsFilterBar } from '@/components/stats/StatsFilterBar';
import { JudgingTabs, SpeakingTabs } from '@/components/stats/StatsTabs';
import { Coverage, HeadlineStats } from '@/components/stats/StatsSections';
import { Quirks } from '@/components/stats/Findings';

/** The filter's own query parameters, cleared and rewritten on each change. */
const FILTER_PARAMS = ['partner', 'pairing', 'seat'] as const;

export type FilterableStatsData = Pick<
  CvData,
  'speakerRows' | 'judgeRows' | 'taggedMotions' | 'fieldStats'
> & {
  /** Motions of the prelim rounds the user judged (Judging → By motion topic). */
  judgedMotions?: CvData['taggedMotions'];
};

/**
 * /cv/stats, filterable by partner, pairing and seat.
 *
 * The server sends the CV data and the round table once. Filtering narrows
 * the data (lib/cv/statsFilter.ts) and the same engine that renders the
 * unfiltered page runs again in the browser, so every section responds
 * instantly and keeps the semantics its tests pin. The filter lives in the
 * URL, so a filtered view can be bookmarked or shared. Filter changes replace
 * the history entry, so Back does not step through them.
 */
export function FilterableStats({ data, facts }: { data: FilterableStatsData; facts: StatsFacts }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The filter is component state, read once from the URL and written back
  // to it. It used to be derived from useSearchParams on the strength of
  // Next syncing history.replaceState into it; on Next 16 that sync did not
  // happen, so a chip changed the URL and nothing else (found 2026-10-29).
  // Tabs (components/ui/Tabs.tsx) keeps its selection the same way.
  const [filter, setFilterState] = useState<StatsFilter>(() =>
    parseStatsFilter(new URLSearchParams(searchParams.toString())),
  );
  // history.replaceState, not router.replace. The page is force-dynamic, so
  // a router navigation to new search params refetches the server component —
  // auth, buildCvData, the round table — and ships the whole payload again
  // for a change the browser computes in a few milliseconds. replaceState
  // also means a filter change adds no history entry: Back leaves /cv/stats
  // rather than undoing the last filter (STAT-14). "Clear filters" is the
  // way back to the unfiltered view.
  const setFilter = useCallback(
    (next: StatsFilter) => {
      setFilterState(next);
      // Keep every other parameter (the tab levels: role, group, section),
      // replacing only the filter's own.
      const params = new URLSearchParams(window.location.search);
      for (const k of FILTER_PARAMS) params.delete(k);
      for (const [k, v] of new URLSearchParams(serializeStatsFilter(next))) params.append(k, v);
      const qs = params.toString();
      window.history.replaceState(window.history.state, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const filtered = useMemo(() => filterCvData(data, facts, filter), [data, facts, filter]);
  const stats = useMemo(() => computeSpeakerStats(filtered), [filtered]);
  const filteredFacts = useMemo(() => filterFacts(facts, filter), [facts, filter]);
  const active = isFilterActive(filter);
  const bySeat = filter.seats.length > 0;

  const totalSpeeches = useMemo(
    () => facts.rounds.filter((r) => r.score != null && !r.isOutround).length,
    [facts],
  );
  // Name the active filters (STAT-7): the pressed chips are the only other
  // place they show, and a screen reader hears this sentence on every change.
  const filterNames = [
    ...(filter.partners.length > 2
      ? [`${filter.partners.length} partners`]
      : filter.partners.map((k) => `partner ${facts.partnerNames[k] ?? 'unknown'}`)),
    ...filter.pairings.map(
      (p) => `pairing ${p === 'marked' ? 'marked pro-am' : 'not marked pro-am'}`,
    ),
    ...filter.seats.map((s) => `seat ${s.replace(':', ' ')}`),
  ].join('; ');
  const summary = active
    ? `Showing ${stats.scoreProfile.speeches.toLocaleString()} of ${totalSpeeches.toLocaleString()} scored prelim speeches, from ${filtered.speakerRows.length} of ${data.speakerRows.length} tournaments, filtered by ${filterNames}.`
    : `All ${totalSpeeches.toLocaleString()} scored prelim speeches from ${data.speakerRows.length} tournaments.`;

  const quirkIds = visibleQuirkIds(
    stats.quirks.map((q) => q.id),
    filter,
  );

  const speaks = facts.rounds.length > 0;

  // The starting tab at each level, read once from the URL; each Tabs keeps
  // its own selection from then on and writes it back (components/ui/Tabs).
  const initial = {
    role: searchParams.get('role') ?? undefined,
    group: searchParams.get('group') ?? undefined,
    section: searchParams.get('section') ?? undefined,
  };
  const judges = data.judgeRows.length > 0;

  const speakingPanel = (
    <div className="space-y-panel">
      {/* Partner, pairing and seat narrow speaking only; judging has none of them. */}
      <StatsFilterBar facts={facts} filter={filter} onChange={setFilter} summary={summary} />
      {active && filtered.speakerRows.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal weight="light" className="h-5 w-5" aria-hidden />}
          title="No rounds match these filters"
          description="Remove a filter. Judging ignores partner and seat."
        />
      ) : (
        <SpeakingTabs
          stats={stats}
          facts={filteredFacts}
          baseline={facts.rounds}
          speakerRows={filtered.speakerRows}
          filtered={active}
          bySeat={bySeat}
          initial={initial}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-group">
      {/*
        The summary strip above the tabs (owner, 2026-10-29): the headline
        figures and the findings, which read across every section below.
      */}
      {speaks ? (
        <div className="space-y-panel">
          <HeadlineStats stats={stats} perRoundOnly={bySeat} filtered={active} />
          <Quirks stats={stats} visibleIds={quirkIds} />
        </div>
      ) : null}

      <Tabs
        label="Statistics by role"
        param="role"
        prominent
        initialValue={initial.role}
        items={[
          ...(speaks ? [{ value: 'speaking', label: 'Speaking', panel: speakingPanel }] : []),
          ...(judges
            ? [
                {
                  value: 'judging',
                  label: 'Judging',
                  panel: (
                    <JudgingTabs
                      speakerRows={data.speakerRows}
                      judgeRows={data.judgeRows}
                      judgedMotions={data.judgedMotions ?? []}
                      initial={initial}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      <Coverage coverage={stats.coverage} />
    </div>
  );
}
