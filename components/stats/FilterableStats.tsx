'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
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
import { SectionHeader } from '@/components/ui/Card';
import { PageJumpNav } from '@/components/PageJumpNav';
import { StatsFilterBar } from '@/components/stats/StatsFilterBar';
import { CrossTabsSection } from '@/components/stats/CrossTabsSection';
import { TopicTypeSection } from '@/components/stats/TopicTypeSection';
import { BreakMarginSection } from '@/components/stats/BreakViews';
import { MilestonesSection, OutroundFunnelSection } from '@/components/stats/CareerViews';
import { JudgingLensSection, SpeakingVsJudgingSection } from '@/components/stats/JudgingViews';
import {
  CarrySection,
  MomentumSection,
  MotionTypesSection,
  PositionsSection,
  RoundCurveSection,
  TeammatesSection,
} from '@/components/stats/StatsViews';
import {
  Coverage,
  FieldStanding,
  TeamStanding,
  HeadlineStats,
  Quirks,
  ResultsSection,
  RoundDynamicsSection,
  STATS_SECTIONS,
  ScoreDistribution,
  SeasonTrends,
  Splits,
} from '@/components/stats/StatsSections';

export type FilterableStatsData = Pick<CvData, 'speakerRows' | 'judgeRows' | 'taggedMotions' | 'fieldStats'>;

/**
 * A section whose figures describe whole tournaments or their round order,
 * shown in place of the real one while filtering by seat. It keeps the
 * section's id so the jump rail still lands somewhere, and says why the
 * numbers are missing instead of leaving a gap.
 */
function WithheldSection({ id, label, title, reason }: { id: string; label: string; title: string; reason: string }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-24 space-y-3">
      <SectionHeader label={label} title={title} />
      <div className="panel-inset p-4 text-table text-ink-soft">{reason}</div>
    </section>
  );
}

/**
 * /cv/stats, filterable by partner, pairing and seat.
 *
 * The server sends the CV data and the round table once. Filtering narrows
 * the data (lib/cv/statsFilter.ts) and the same engine that renders the
 * unfiltered page runs again in the browser, so every section responds
 * instantly and keeps the semantics its tests pin. The filter lives in the
 * URL, so a filtered view can be bookmarked, shared, or reached with Back.
 */
export function FilterableStats({ data, facts }: { data: FilterableStatsData; facts: StatsFacts }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filter = useMemo(
    () => parseStatsFilter(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  // history.replaceState, not router.replace. The page is force-dynamic, so
  // a router navigation to new search params refetches the server component —
  // auth, buildCvData, the round table — and ships the whole payload again
  // for a change the browser computes in a few milliseconds. Next syncs
  // replaceState into useSearchParams, so the filter still lives in the URL.
  const setFilter = useCallback(
    (next: StatsFilter) => {
      const qs = serializeStatsFilter(next);
      window.history.replaceState(window.history.state, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const filtered = useMemo(() => filterCvData(data, facts, filter), [data, facts, filter]);
  const stats = useMemo(() => computeSpeakerStats(filtered), [filtered]);
  const filteredFacts = useMemo(() => filterFacts(facts, filter), [facts, filter]);
  const active = isFilterActive(filter);
  const bySeat = filter.seats.length > 0;

  const totalSpeeches = useMemo(() => facts.rounds.filter((r) => r.score != null && !r.isOutround).length, [facts]);
  const summary = active
    ? `Showing ${stats.scoreProfile.speeches.toLocaleString()} of ${totalSpeeches.toLocaleString()} scored prelim speeches, from ${filtered.speakerRows.length} of ${data.speakerRows.length} tournaments.`
    : `All ${totalSpeeches.toLocaleString()} scored prelim speeches from ${data.speakerRows.length} tournaments. Narrow by partner, pairing or seat.`;

  const quirkIds = visibleQuirkIds(stats.quirks.map((q) => q.id), filter);

  const speaks = facts.rounds.length > 0;

  // The rail lists only sections that rendered. Any section can return null
  // (no findings under a filter, a judging-only record), and a rail link to
  // an id that isn't on the page does nothing when clicked.
  const [presentIds, setPresentIds] = useState<string[]>(() => STATS_SECTIONS.map((s) => s.id));
  useEffect(() => {
    const ids = STATS_SECTIONS.filter((s) => document.getElementById(s.id)).map((s) => s.id);
    setPresentIds((prev) => (prev.join() === ids.join() ? prev : ids));
  }, [filteredFacts, stats, speaks]);
  const railTargets = useMemo(() => STATS_SECTIONS.filter((s) => presentIds.includes(s.id)), [presentIds]);

  return (
    <div className="space-y-8">
      {/* A judging-only record has nothing to filter: no partners, no seats. */}
      {speaks ? <StatsFilterBar facts={facts} filter={filter} onChange={setFilter} summary={summary} /> : null}

      {active && filtered.speakerRows.length === 0 ? (
        <div className="space-y-10">
          <EmptyState
            icon={<SlidersHorizontal className="h-5 w-5" aria-hidden />}
            title="No rounds match these filters"
            description="Nothing on your record fits every filter at once. Remove one to widen the view. Judging has no partner or seat, so it still shows below."
          />
          <SpeakingVsJudgingSection speakerRows={data.speakerRows} judgeRows={data.judgeRows} />
          <JudgingLensSection judgeRows={data.judgeRows} />
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10">
          <div className="space-y-10 lg:order-1">
            <HeadlineStats stats={stats} perRoundOnly={bySeat} filtered={active} />
            <Quirks stats={stats} visibleIds={quirkIds} />
            <ScoreDistribution stats={stats} />
            {bySeat ? (
              <WithheldSection
                id="team-tab"
                label="Team tab"
                title="How high your team placed"
                reason="Team placement is a fact about a whole tournament, so it isn't shown while filtering by seat."
              />
            ) : (
              <TeamStanding stats={stats} />
            )}
            {bySeat ? (
              <WithheldSection
                id="field"
                label="Speaker tab"
                title="How your own scores placed among the speakers"
                reason="Speaker-tab placement is a fact about a whole tournament, so it isn't shown while filtering by seat."
              />
            ) : (
              <FieldStanding stats={stats} />
            )}
            {bySeat ? (
              <WithheldSection
                id="dynamics"
                label="Round dynamics"
                title="Across a tournament"
                reason="Openings, closings and momentum follow the order of rounds within a tournament, which a seat filter breaks up."
              />
            ) : (
              <RoundDynamicsSection stats={stats} />
            )}
            <RoundCurveSection facts={filteredFacts} baseline={facts.rounds} />
            {bySeat ? (
              <WithheldSection
                id="momentum"
                label="Momentum"
                title="The round after a win, and after a loss"
                reason="Momentum pairs each round with the next one, and a seat filter removes the rounds in between."
              />
            ) : (
              <MomentumSection facts={filteredFacts} baseline={facts.rounds} />
            )}
            <ResultsSection stats={stats} perRoundOnly={bySeat} />
            {bySeat ? (
              <WithheldSection
                id="funnel"
                label="Outrounds"
                title="From break to title"
                reason="Breaks and outrounds are facts about whole tournaments, so they aren't shown while filtering by seat."
              />
            ) : (
              <OutroundFunnelSection tournaments={filteredFacts.tournaments} />
            )}
            {bySeat ? (
              <WithheldSection
                id="break-margin"
                label="Break margin"
                title="How close to the break line"
                reason="The break line is a fact about a whole tournament, so it isn't shown while filtering by seat."
              />
            ) : (
              <BreakMarginSection speakerRows={filtered.speakerRows} />
            )}
            <PositionsSection facts={filteredFacts} baseline={facts.rounds} />
            <MotionTypesSection facts={filteredFacts} baseline={facts.rounds} />
            <CrossTabsSection facts={filteredFacts} baseline={facts.rounds} />
            <TopicTypeSection facts={filteredFacts} knockoutsWithheld={bySeat} />
            <Splits stats={stats} filtered={active} omit={['position', 'motionType']} />
            <TeammatesSection facts={filteredFacts} perRoundOnly={bySeat} />
            <CarrySection facts={filteredFacts} baseline={facts.rounds} byPairing={filter.pairings.length > 0} />
            {bySeat ? (
              <WithheldSection
                id="seasons"
                label="Seasons"
                title="Year by year"
                reason="Seasons are counted in tournaments and breaks, so they aren't shown while filtering by seat."
              />
            ) : (
              <div className="space-y-2">
                <SeasonTrends seasons={stats.seasons} judging={stats.judgingSeasons} />
                {active && stats.judgingSeasons.length > 0 ? (
                  <p className="text-caption text-ink-soft">
                    Judging has no partner or pairing, so its seasons cover your whole record.
                  </p>
                ) : null}
              </div>
            )}
            {bySeat ? (
              <WithheldSection
                id="milestones"
                label="Milestones"
                title="Firsts and records"
                reason="Firsts, tab ranks and break runs describe whole tournaments, so they aren't shown while filtering by seat."
              />
            ) : (
              <MilestonesSection speakerRows={filtered.speakerRows} />
            )}
            {/* Judging has no partner, pairing or seat: always the whole record. */}
            <SpeakingVsJudgingSection speakerRows={data.speakerRows} judgeRows={data.judgeRows} />
            <JudgingLensSection judgeRows={data.judgeRows} />
            <Coverage coverage={stats.coverage} />
          </div>
          {/* Keyed by the filter: withheld sections replace real ones under the
              same ids, and the rail's observer must watch the new nodes. */}
          <PageJumpNav
            key={serializeStatsFilter(filter)}
            className="mb-6 lg:order-2 lg:mb-0"
            targets={railTargets}
          />
        </div>
      )}
    </div>
  );
}
