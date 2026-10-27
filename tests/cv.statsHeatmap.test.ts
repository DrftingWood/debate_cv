import { describe, expect, it } from 'vitest';
import { knockoutRecord, topicTypeHeatmap } from '@/lib/cv/statsHeatmap';
import { MIN_QUIRK_ROUNDS } from '@/lib/cv/speakerStats';
import type { KnockoutFact, RoundFact } from '@/lib/cv/statsFacts';

let n = 0;
function round(over: Partial<RoundFact>): RoundFact {
  n += 1;
  return {
    tournamentId: 't1',
    year: 2025,
    format: 'British Parliamentary',
    round: n,
    isOutround: false,
    seat: 'BP:OG',
    partners: [],
    partnerGap: null,
    proAm: null,
    motionType: 'Policy',
    motionTopic: 'Economics & Business',
    hasMotion: true,
    contextLed: false,
    infoSlide: false,
    score: 75,
    partnerScores: [],
    points: null,
    won: null,
    ...over,
  };
}
const many = (count: number, over: Partial<RoundFact>) =>
  Array.from({ length: count }, () => round(over));

describe('topicTypeHeatmap', () => {
  it('hides the figures of a cell below the sample gate but keeps its count', () => {
    const h = topicTypeHeatmap([...many(MIN_QUIRK_ROUNDS - 1, { score: 80 })]);
    expect(h.cells).toHaveLength(1);
    expect(h.cells[0]).toMatchObject({
      rounds: MIN_QUIRK_ROUNDS - 1,
      enough: false,
      avgScore: null,
      scoreDelta: null,
    });
  });

  it('shows the mean and the delta against the grid baseline once the gate is met', () => {
    const h = topicTypeHeatmap([
      ...many(MIN_QUIRK_ROUNDS, { motionTopic: 'Education', motionType: 'Belief', score: 80 }),
      ...many(MIN_QUIRK_ROUNDS, {
        motionTopic: 'Economics & Business',
        motionType: 'Policy',
        score: 70,
      }),
    ]);
    expect(h.baseline).toBeCloseTo(75, 6);
    const edu = h.cells.find((c) => c.topic === 'Education')!;
    expect(edu.enough).toBe(true);
    expect(edu.avgScore).toBeCloseTo(80, 6);
    expect(edu.scoreDelta).toBeCloseTo(5, 6);
    const eco = h.cells.find((c) => c.topic === 'Economics & Business')!;
    expect(eco.scoreDelta).toBeCloseTo(-5, 6);
  });

  it('counts only scored prelim rounds with both a type and a topic', () => {
    const h = topicTypeHeatmap([
      round({ isOutround: true }),
      round({ score: null }),
      round({ motionType: null }),
      round({ motionTopic: null }),
      round({ motionTopic: undefined }),
      round({}),
    ]);
    expect(h.scoredRounds).toBe(4);
    expect(h.coveredRounds).toBe(1);
  });

  it('counts the distinct tournaments behind a cell', () => {
    const h = topicTypeHeatmap([
      ...many(3, { tournamentId: 'a' }),
      ...many(3, { tournamentId: 'b' }),
    ]);
    expect(h.cells[0].tournaments).toBe(2);
    expect(h.cells[0].rounds).toBe(6);
  });

  it('orders rows and columns by the rounds behind them', () => {
    const h = topicTypeHeatmap([
      ...many(2, { motionTopic: 'Education', motionType: 'Belief' }),
      ...many(6, { motionTopic: 'Media & Arts', motionType: 'Policy' }),
      ...many(3, { motionTopic: 'Media & Arts', motionType: 'Belief' }),
    ]);
    expect(h.topics).toEqual(['Media & Arts', 'Education']);
    expect(h.types).toEqual(['Policy', 'Belief']);
  });

  it('clubs rounds that offered several different motions into one bucket instead of dropping them', () => {
    const h = topicTypeHeatmap([
      ...many(MIN_QUIRK_ROUNDS, {
        choiceRound: true,
        motionType: null,
        motionTopic: null,
        score: 80,
      }),
      ...many(MIN_QUIRK_ROUNDS, { motionTopic: 'Education', motionType: 'Belief', score: 70 }),
    ]);
    expect(h.mixed).toMatchObject({ rounds: MIN_QUIRK_ROUNDS, enough: true });
    expect(h.mixed!.avgScore).toBeCloseTo(80, 6);
    // one baseline for the whole grid: (80 + 70) / 2
    expect(h.baseline).toBeCloseTo(75, 6);
    expect(h.mixed!.scoreDelta).toBeCloseTo(5, 6);
    expect(h.cells).toHaveLength(1);
    expect(h.coveredRounds).toBe(MIN_QUIRK_ROUNDS * 2);
  });

  it('has no choice bucket when no round offered a choice', () => {
    expect(topicTypeHeatmap(many(6, {})).mixed).toBeNull();
  });

  it('is empty and has no baseline when no round has a topic or a class', () => {
    const h = topicTypeHeatmap([round({ motionTopic: null, motionType: null })]);
    expect(h.cells).toEqual([]);
    expect(h.baseline).toBeNull();
    expect(h.coveredRounds).toBe(0);
  });

  it('counts a round with a known topic in the topic margin even when its class is unknown', () => {
    // An untagged-class round used to drop out of the section entirely.
    const h = topicTypeHeatmap([
      ...many(MIN_QUIRK_ROUNDS - 1, { motionTopic: 'Education', motionType: 'Policy', score: 80 }),
      round({ motionTopic: 'Education', motionType: null, score: 80 }),
      ...many(MIN_QUIRK_ROUNDS, { motionTopic: 'Media & Arts', motionType: null, score: 70 }),
    ]);
    expect(h.cells).toHaveLength(1);
    expect(h.cells[0].enough).toBe(false);
    const edu = h.topicTotals.find((t) => t.key === 'Education');
    expect(edu).toMatchObject({ rounds: MIN_QUIRK_ROUNDS, enough: true });
    expect(edu?.scoreDelta).toBeCloseTo(5, 6);
    expect(h.typeTotals).toEqual([
      expect.objectContaining({ key: 'Policy', rounds: MIN_QUIRK_ROUNDS - 1 }),
    ]);
  });

  it('a choice round whose options share a topic still counts on that topic', () => {
    const h = topicTypeHeatmap(
      many(MIN_QUIRK_ROUNDS, { choiceRound: true, motionTopic: 'Education', motionType: null }),
    );
    expect(h.mixed?.rounds).toBe(MIN_QUIRK_ROUNDS);
    expect(h.topicTotals[0]).toMatchObject({ key: 'Education', rounds: MIN_QUIRK_ROUNDS });
  });

  it('accounts for every scored round exactly once in the coverage breakdown', () => {
    const h = topicTypeHeatmap([
      round({}),
      round({ hasMotion: false, motionTopic: null, motionType: null }),
      round({ choiceRound: true, motionTopic: null, motionType: null }),
      round({ motionTopic: null, untagged: true }),
      round({ motionType: null, unclassified: true }),
      round({ isOutround: true }),
    ]);
    expect(h.coverage).toEqual({
      scored: 5,
      covered: 1,
      choice: 1,
      noMotion: 1,
      untagged: 1,
      unclassified: 1,
    });
  });
});

describe('knockoutRecord', () => {
  const ko = (over: Partial<KnockoutFact>): KnockoutFact => ({
    tournamentId: 't1',
    stage: 'Semifinals',
    won: true,
    final: false,
    motionType: 'Policy',
    motionTopic: 'Education',
    choiceRound: false,
    untagged: false,
    unclassified: false,
    hasMotion: true,
    ...over,
  });

  it('counts results by topic and by class, with no sample gate', () => {
    const r = knockoutRecord([
      ko({}),
      ko({ won: false, stage: 'Grand Final', final: true }),
      ko({ motionTopic: 'Media & Arts', motionType: 'Belief' }),
    ]);
    expect(r).toMatchObject({ rounds: 3, won: 2, lost: 1, noMotion: 0, noTopic: 0, choice: null });
    expect(r.byTopic).toEqual([
      { key: 'Education', won: 1, lost: 1 },
      { key: 'Media & Arts', won: 1, lost: 0 },
    ]);
    expect(r.byType).toEqual([
      { key: 'Policy', won: 1, lost: 1 },
      { key: 'Belief', won: 1, lost: 0 },
    ]);
  });

  it('names what it cannot place instead of dropping it', () => {
    const r = knockoutRecord([
      ko({ hasMotion: false, motionTopic: null, motionType: null }),
      ko({ untagged: true, motionTopic: null }),
      ko({ choiceRound: true, motionTopic: null, motionType: null, won: false }),
    ]);
    expect(r).toMatchObject({ rounds: 3, noMotion: 1, noTopic: 2 });
    expect(r.choice).toEqual({ key: 'choice', won: 0, lost: 1 });
  });
});
