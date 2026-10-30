'use client';

import type { ReactNode } from 'react';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { SectionHeader } from '@/components/ui/Card';
import type { SpeakerStats } from '@/lib/cv/speakerStats';
import type { CvJudgeRow, CvSpeakerRow, CvTaggedMotion } from '@/lib/cv/buildCvData';
import type { RoundFact, StatsFacts } from '@/lib/cv/statsFacts';
import { CrossTabsSection } from '@/components/stats/CrossTabsSection';
import { TopicTypeSection } from '@/components/stats/TopicTypeSection';
import { BreakMarginSection } from '@/components/stats/BreakViews';
import { MilestonesSection, OutroundFunnelSection } from '@/components/stats/CareerViews';
import {
  JudgingChairSection,
  JudgingOutroundsSection,
  JudgingRolesSection,
  JudgingStageSection,
  SpeakingVsJudgingSection,
} from '@/components/stats/JudgingViews';
import {
  JudgingFormatSection,
  JudgingTopicSection,
  TopFinishesSection,
} from '@/components/stats/NewSlotViews';
import {
  CarrySection,
  MomentumSection,
  MotionTypesSection,
  PositionsSection,
  RoundCurveSection,
  TeammatesSection,
} from '@/components/stats/StatsViews';
import {
  FieldStanding,
  ResultsSection,
  RoundDynamicsSection,
  ScoreDistribution,
  Splits,
  TeamStanding,
} from '@/components/stats/StatsSections';

/*
 * The Statistics tab tree (redesign owner decision 19, 2026-10-29): three
 * levels, each mutually exclusive and together exhaustive, every level in
 * the URL (`?role=speaking&group=results&section=breaks`) and on the APG
 * tab model (components/ui/Tabs.tsx).
 *
 *   Speaking
 *     Team results:   Team placement · Breaks · Straights & firsts
 *     Speaks:         Speaker tab · Score bands · Top-10 finishes
 *     Conditions:     By position · By format · By round · By motion topic ·
 *                     By motion type · By partner
 *   Judging
 *     Results:        Outrounds judged · Chairing · Core roles · Speaking vs judging
 *     Conditions:     By format · By stage · By motion topic
 *
 * Every section that was on the long page has a slot (owner, 2026-10-29):
 * Cross-tabs sits under By motion type, Speaking vs judging under Judging.
 * Seasons is gone, as the Record's yearly charts carry it.
 *
 * Desktop: level 3 is a vertical list beside one section; a phone gets it as
 * a "Section" dropdown. A level whose only item would be one section still
 * shows its tab, so the hierarchy reads the same on every record.
 *
 * Under a seat filter the sections that describe whole tournaments are
 * replaced by a note saying why (`Withheld`), keeping their slot.
 */

type Initial = { role?: string; group?: string; section?: string };

/** A level-3 section list: vertical on desktop, a dropdown on a phone. */
function Sections({
  label,
  items,
  initial,
}: {
  label: string;
  items: TabItem[];
  initial?: string;
}) {
  // A section renders nothing when the record has no data for it (no
  // positions parsed, a judging-only record). The `peer-empty` line says so
  // instead of leaving a blank panel behind a tab.
  const slotted = items.map((i) => ({
    ...i,
    panel: (
      <>
        <div className="peer space-y-section">{i.panel}</div>
        <p className="hidden text-body text-ink-soft peer-empty:block">
          Not enough on your record for {i.label.toLowerCase()} yet.
        </p>
      </>
    ),
  }));
  return (
    <Tabs
      label={label}
      param="section"
      items={slotted}
      initialValue={initial}
      orientation="vertical"
      phoneSelect
    />
  );
}

function Withheld({ label, title, reason }: { label: string; title: string; reason: string }) {
  return (
    <section aria-label={title} className="space-y-3">
      <SectionHeader label={label} title={title} />
      <div className="panel-inset p-4 text-table text-ink-soft">{reason}</div>
    </section>
  );
}

/**
 * A slot's sections, side by side in the tree with no wrapper of their own,
 * so a slot whose sections all render nothing is truly empty and the
 * fallback line shows (the slot spaces them, `space-y-section`).
 */
function Stack({ children }: { children: ReactNode[] }) {
  return <>{children}</>;
}

export function SpeakingTabs({
  stats,
  facts,
  baseline,
  speakerRows,
  filtered,
  bySeat,
  initial,
}: {
  stats: SpeakerStats;
  facts: StatsFacts;
  baseline: RoundFact[];
  speakerRows: CvSpeakerRow[];
  filtered: boolean;
  bySeat: boolean;
  initial: Initial;
}) {
  const wholeTournament = (label: string, title: string) => (
    <Withheld
      label={label}
      title={title}
      reason={`${title} describes whole tournaments, so it isn't shown while filtering by seat.`}
    />
  );

  const results: TabItem[] = [
    {
      value: 'team-placement',
      label: 'Team placement',
      panel: bySeat ? (
        wholeTournament('Team tab', 'Team placement')
      ) : (
        <TeamStanding stats={stats} />
      ),
    },
    {
      value: 'breaks',
      label: 'Breaks',
      panel: bySeat ? (
        wholeTournament('Outrounds', 'Breaks')
      ) : (
        <Stack>
          <OutroundFunnelSection tournaments={facts.tournaments} />
          <BreakMarginSection speakerRows={speakerRows} />
        </Stack>
      ),
    },
    {
      value: 'straights',
      label: 'Straights & firsts',
      panel: (
        <Stack>
          <ResultsSection stats={stats} perRoundOnly={bySeat} />
          {bySeat ? null : <MilestonesSection speakerRows={speakerRows} />}
        </Stack>
      ),
    },
  ];

  const speaks: TabItem[] = [
    {
      value: 'speaker-tab',
      label: 'Speaker tab',
      panel: bySeat ? (
        wholeTournament('Speaker tab', 'Speaker-tab placement')
      ) : (
        <FieldStanding stats={stats} />
      ),
    },
    { value: 'score-bands', label: 'Score bands', panel: <ScoreDistribution stats={stats} /> },
    {
      value: 'top-finishes',
      label: 'Top-10 finishes',
      panel: bySeat ? (
        wholeTournament('Speaker tab', 'Top-10 finishes')
      ) : (
        <TopFinishesSection speakerRows={speakerRows} />
      ),
    },
  ];

  const keepOnly = (keep: string[]) =>
    ['position', 'motionType', 'motionTopic', 'format', 'region', 'fieldSize', 'year'].filter(
      (k) => !keep.includes(k),
    );

  const conditions: TabItem[] = [
    {
      value: 'position',
      label: 'By position',
      panel: <PositionsSection facts={facts} baseline={baseline} />,
    },
    {
      value: 'format',
      label: 'By format',
      panel: (
        <Splits
          id="splits-format"
          stats={stats}
          filtered={filtered}
          omit={keepOnly(['format', 'region', 'fieldSize'])}
        />
      ),
    },
    {
      value: 'round',
      label: 'By round',
      panel: (
        <Stack>
          {bySeat ? (
            <Withheld
              label="Round dynamics"
              title="Across a tournament"
              reason="Openings, closings and momentum need rounds in order, which a seat filter breaks up."
            />
          ) : (
            <RoundDynamicsSection stats={stats} />
          )}
          <RoundCurveSection facts={facts} baseline={baseline} />
          {bySeat ? null : <MomentumSection facts={facts} baseline={baseline} />}
        </Stack>
      ),
    },
    {
      value: 'motion-topic',
      label: 'By motion topic',
      panel: (
        <Stack>
          <TopicTypeSection facts={facts} knockoutsWithheld={bySeat} />
          <Splits
            id="splits-topic"
            stats={stats}
            filtered={filtered}
            omit={keepOnly(['motionTopic'])}
          />
        </Stack>
      ),
    },
    {
      value: 'motion-type',
      label: 'By motion type',
      panel: (
        <Stack>
          <MotionTypesSection facts={facts} baseline={baseline} />
          <Splits
            id="splits-stem"
            stats={stats}
            filtered={filtered}
            omit={keepOnly(['motionType'])}
          />
          <CrossTabsSection facts={facts} baseline={baseline} />
        </Stack>
      ),
    },
    {
      value: 'partner',
      label: 'By partner',
      panel: (
        <Stack>
          <TeammatesSection facts={facts} perRoundOnly={bySeat} />
          <CarrySection facts={facts} baseline={baseline} />
        </Stack>
      ),
    },
  ];

  return (
    <Tabs
      label="Speaking statistics"
      param="group"
      initialValue={initial.group}
      items={[
        {
          value: 'results',
          label: 'Team results',
          panel: <Sections label="Team results" items={results} initial={initial.section} />,
        },
        {
          value: 'speaks',
          label: 'Speaks',
          panel: <Sections label="Your speaks" items={speaks} initial={initial.section} />,
        },
        {
          value: 'conditions',
          label: 'Position & motion',
          panel: (
            <Sections label="Speaking conditions" items={conditions} initial={initial.section} />
          ),
        },
      ]}
    />
  );
}

export function JudgingTabs({
  speakerRows,
  judgeRows,
  judgedMotions,
  initial,
}: {
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  judgedMotions: CvTaggedMotion[];
  initial: Initial;
}) {
  const results: TabItem[] = [
    {
      value: 'outrounds',
      label: 'Outrounds judged',
      panel: <JudgingOutroundsSection judgeRows={judgeRows} />,
    },
    { value: 'chairing', label: 'Chairing', panel: <JudgingChairSection judgeRows={judgeRows} /> },
    { value: 'core', label: 'Core roles', panel: <JudgingRolesSection judgeRows={judgeRows} /> },
    {
      value: 'speaking-vs-judging',
      label: 'Speaking vs judging',
      panel: <SpeakingVsJudgingSection speakerRows={speakerRows} judgeRows={judgeRows} />,
    },
  ];
  const conditions: TabItem[] = [
    { value: 'format', label: 'By format', panel: <JudgingFormatSection judgeRows={judgeRows} /> },
    { value: 'stage', label: 'By stage', panel: <JudgingStageSection judgeRows={judgeRows} /> },
    {
      value: 'motion-topic',
      label: 'By motion topic',
      panel: <JudgingTopicSection judgeRows={judgeRows} motions={judgedMotions} />,
    },
  ];
  return (
    <Tabs
      label="Judging statistics"
      param="group"
      initialValue={initial.group}
      items={[
        {
          value: 'results',
          label: 'Results',
          panel: <Sections label="Judging results" items={results} initial={initial.section} />,
        },
        {
          value: 'conditions',
          label: 'Position & motion',
          panel: (
            <Sections label="Judging conditions" items={conditions} initial={initial.section} />
          ),
        },
      ]}
    />
  );
}
