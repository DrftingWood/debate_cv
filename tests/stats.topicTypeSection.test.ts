import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopicTypeSection } from '@/components/stats/TopicTypeSection';
import type { RoundFact, StatsFacts } from '@/lib/cv/statsFacts';

// the component is compiled with the classic JSX runtime under Vitest
(globalThis as unknown as { React: typeof React }).React = React;

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
    motionTopic: 'Education',
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
const factsOf = (rounds: RoundFact[]): StatsFacts => ({ rounds, tournaments: [], partnerNames: {} });
const html = (rounds: RoundFact[]) => renderToStaticMarkup(createElement(TopicTypeSection, { facts: factsOf(rounds) }));

describe('TopicTypeSection', () => {
  it('renders nothing until a cell clears the sample gate', () => {
    expect(html(many(3, {}))).toBe('');
  });

  it('shows the topic, the type and a signed delta for a cell over the gate', () => {
    const out = html([
      ...many(6, { motionTopic: 'Education', motionType: 'Policy', score: 80 }),
      ...many(6, { motionTopic: 'Media & Arts', motionType: 'Belief', score: 70 }),
    ]);
    expect(out).toContain('Topic × type');
    expect(out).toContain('Education');
    expect(out).toContain('Policy');
    expect(out).toContain('+5.0');
    expect(out).toContain('−5.0');
    expect(out).toContain('12 of 12 scored prelim rounds');
  });

  it('shows a dot, not a figure, for a thin cell next to a full one', () => {
    const out = html([
      ...many(6, { motionTopic: 'Education', motionType: 'Policy', score: 80 }),
      ...many(2, { motionTopic: 'Education', motionType: 'Belief', score: 60 }),
    ]);
    expect(out).toContain('2 rounds, too few to show');
    expect(out).not.toContain('−');
  });
});
