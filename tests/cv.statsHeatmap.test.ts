import { describe, expect, it } from 'vitest';
import { topicTypeHeatmap } from '@/lib/cv/statsHeatmap';
import { MIN_QUIRK_ROUNDS } from '@/lib/cv/speakerStats';
import type { RoundFact } from '@/lib/cv/statsFacts';

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
const many = (count: number, over: Partial<RoundFact>) => Array.from({ length: count }, () => round(over));

describe('topicTypeHeatmap', () => {
  it('hides the figures of a cell below the sample gate but keeps its count', () => {
    const h = topicTypeHeatmap([...many(MIN_QUIRK_ROUNDS - 1, { score: 80 })]);
    expect(h.cells).toHaveLength(1);
    expect(h.cells[0]).toMatchObject({ rounds: MIN_QUIRK_ROUNDS - 1, enough: false, avgScore: null, scoreDelta: null });
  });

  it('shows the mean and the delta against the grid baseline once the gate is met', () => {
    const h = topicTypeHeatmap([
      ...many(MIN_QUIRK_ROUNDS, { motionTopic: 'Education', motionType: 'Belief', score: 80 }),
      ...many(MIN_QUIRK_ROUNDS, { motionTopic: 'Economics & Business', motionType: 'Policy', score: 70 }),
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

  it('is empty and has no baseline when nothing is tagged', () => {
    const h = topicTypeHeatmap([round({ motionTopic: null })]);
    expect(h.cells).toEqual([]);
    expect(h.baseline).toBeNull();
    expect(h.coveredRounds).toBe(0);
  });
});
