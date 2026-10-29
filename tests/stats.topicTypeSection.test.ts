import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopicTypeSection } from '@/components/stats/TopicTypeSection';
import type { KnockoutFact, RoundFact, StatsFacts } from '@/lib/cv/statsFacts';

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
const many = (count: number, over: Partial<RoundFact>) =>
  Array.from({ length: count }, () => round(over));
const factsOf = (rounds: RoundFact[]): StatsFacts => ({
  rounds,
  tournaments: [],
  partnerNames: {},
});
const html = (rounds: RoundFact[]) =>
  renderToStaticMarkup(createElement(TopicTypeSection, { facts: factsOf(rounds) }));

describe('TopicTypeSection', () => {
  it('explains the sample gate instead of rendering nothing when no cell clears it', () => {
    // It used to return null here, which read as a broken feature.
    const out = html(many(3, {}));
    expect(out).toContain('3 of 3 scored prelim rounds have both a topic and a class');
    expect(out).toContain('has reached 6 scored rounds yet');
    expect(out).not.toContain('<table');
  });

  it('renders nothing when no round has a motion and there are no knockouts', () => {
    expect(html(many(3, { hasMotion: false, motionTopic: null, motionType: null }))).toBe('');
  });

  it('says where the rounds outside the grid went', () => {
    const out = html([
      ...many(6, {}),
      round({ hasMotion: false, motionTopic: null, motionType: null }),
      round({ motionTopic: null, untagged: true }),
      round({ motionType: null, unclassified: true }),
    ]);
    expect(out).toContain('6 of 9 scored prelim rounds');
    expect(out).toContain('1 round with no motion on record');
    expect(out).toContain('1 round with an untagged motion');
    expect(out).toContain('1 round whose wording the classifier can&#x27;t place');
  });

  it('labels the class honestly as read from the wording, not the stem tag', () => {
    const out = html(many(6, {}));
    expect(out).toContain('Topic × motion class');
    expect(out).toContain('Class is read from the wording');
    expect(out).toContain('under 6 rounds');
  });

  it('shows the knockout record by topic and class for the tournaments the filter kept', () => {
    const k = (over: Partial<KnockoutFact>): KnockoutFact => ({
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
    const facts: StatsFacts = {
      rounds: many(2, {}),
      knockouts: [
        k({}),
        k({ won: false, stage: 'Grand Final', final: true }),
        k({ tournamentId: 'gone' }),
      ],
      tournaments: [{ tournamentId: 't1' } as StatsFacts['tournaments'][number]],
      partnerNames: {},
    };
    const out = renderToStaticMarkup(createElement(TopicTypeSection, { facts }));
    expect(out).toContain('2 knockout rounds, 1 through');
    expect(out).toContain('Knockout results by topic');
    const withheld = renderToStaticMarkup(
      createElement(TopicTypeSection, { facts, knockoutsWithheld: true }),
    );
    expect(withheld).not.toContain('Knockout results by topic');
    expect(withheld).toContain('hidden under a seat filter');
  });

  it('shows the topic, the type and a signed delta for a cell over the gate', () => {
    const out = html([
      ...many(6, { motionTopic: 'Education', motionType: 'Policy', score: 80 }),
      ...many(6, { motionTopic: 'Media & Arts', motionType: 'Belief', score: 70 }),
    ]);
    expect(out).toContain('Topic × motion class');
    expect(out).toContain('Education');
    expect(out).toContain('Policy');
    expect(out).toContain('+5.0');
    expect(out).toContain('−5.0');
    expect(out).toContain('12 of 12 scored prelim rounds');
  });

  it('shows the clubbed choice-of-motions bucket and keeps the section when only it clears the gate', () => {
    const out = html(
      many(6, { choiceRound: true, motionType: null, motionTopic: null, score: 80 }),
    );
    expect(out).toContain('Choice of motions');
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
