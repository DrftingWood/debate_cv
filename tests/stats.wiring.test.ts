/**
 * How /cv/stats wires its sections to the filter. The pure modules have their
 * own tests; what none of them can catch is the page passing the filtered
 * slice where the whole record belongs, forgetting to withhold a
 * tournament-level section under a seat filter, or letting a speaking filter
 * hide judging. Rendered to static HTML with next/navigation mocked.
 */
import { describe, expect, test, vi } from 'vitest';
import React, { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { buildStatsFacts } from '@/lib/cv/statsFacts';
import { makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

// The components are compiled with the classic JSX runtime under vitest.
(globalThis as unknown as { React: typeof React }).React = React;

let query = '';
vi.mock('next/navigation', () => ({
  usePathname: () => '/cv/stats',
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ replace: () => {} }),
}));

const { FilterableStats } = await import('@/components/stats/FilterableStats');

const seats = ['OG', 'OO', 'CG', 'CO'];
const row = (id: bigint, year: number, partner: string, base: number) =>
  makeSpeakerRow({
    tournamentId: id,
    tournamentName: `Open ${id}`,
    year,
    prelimRoundCount: 8,
    teammates: [partner],
    teammateDetails: [
      {
        key: `p-${partner}`,
        name: partner,
        speakerScoreTotal: null,
        roundScores: Array.from({ length: 8 }, (_, i) => ({
          roundNumber: i + 1,
          positionLabel: null,
          score: base,
        })),
      },
    ],
    roundScores: Array.from({ length: 8 }, (_, i) => ({
      roundNumber: i + 1,
      positionLabel: null,
      score: base + (i % 4 === 0 ? 2 : 0),
    })),
    teamRoundResults: Array.from({ length: 8 }, (_, i) => ({
      roundNumber: i + 1,
      position: seats[i % 4],
      won: i % 4 === 0,
      points: i % 4 === 0 ? 3 : 1,
    })),
    broke: id === 1n,
    eliminationReached: id === 1n ? 'Semifinals' : null,
  });

const data = {
  speakerRows: [row(1n, 2023, 'Ann', 75), row(2n, 2024, 'Bob', 76), row(3n, 2024, 'Ann', 75)],
  judgeRows: [
    makeJudgeRow({
      tournamentId: 9n,
      year: 2024,
      inroundsJudged: 5,
      inroundsChaired: 3,
      broke: true,
      lastOutroundJudged: 'Quarterfinals',
    }),
  ],
  taggedMotions: [],
  fieldStats: [],
};
const facts = buildStatsFacts(data);

function render(q: string) {
  query = q;
  return renderToString(createElement(FilterableStats, { data, facts }));
}
const sectionIds = (html: string) => [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
const section = (html: string, id: string) => {
  const start = html.indexOf(`<section id="${id}"`);
  return start < 0 ? null : html.slice(start, html.indexOf('</section>', start));
};
const rowText = (html: string, label: string) =>
  html
    .match(new RegExp(`<tr[^>]*>(?:(?!</tr>).)*>${label}<(?:(?!</tr>).)*</tr>`, 's'))?.[0]
    .replace(/<[^>]+>/g, '|') ?? null;

describe('/cv/stats wiring', () => {
  // Only the selected tab at each level is built (owner review 2026-10-29:
  // hidden panels made pages heavy), so each assertion opens its section
  // through the URL, as a reader's link would.
  test('section ids are unique, unfiltered and under a seat filter', () => {
    for (const q of [
      '',
      'seat=BP:OG',
      'group=conditions&section=motion-type',
      'role=judging&group=conditions&section=stage',
    ]) {
      const ids = sectionIds(render(q));
      expect(ids.length, q).toBeGreaterThan(0);
      expect(new Set(ids).size, q).toBe(ids.length);
    }
  });

  test('only the selected panel at each level is built', () => {
    const html = render('');
    expect(section(html, 'positions')).toBeNull();
    expect(section(html, 'judging-outrounds')).toBeNull();
  });

  test('a seat filter withholds tournament-level sections with a reason, keeping their slots', () => {
    for (const [q, title] of [
      ['group=results&section=team-placement', 'Team placement'],
      ['group=results&section=breaks', 'Breaks'],
      ['group=speaks&section=speaker-tab', 'Speaker-tab placement'],
      ['group=conditions&section=round', 'Across a tournament'],
    ]) {
      const html = render(`${q}&seat=BP:OG`);
      expect(html, title).toContain(`aria-label="${title}"`);
      expect(html, title).toMatch(/filtering by seat|seat filter/);
    }
    // Momentum and milestones follow whole tournaments: under a seat they are left out.
    expect(section(render('group=conditions&section=round&seat=BP:OG'), 'momentum')).toBeNull();
    expect(section(render('group=results&section=straights&seat=BP:OG'), 'milestones')).toBeNull();
    // Teammates drops tournament breaks under a seat filter.
    const partners = render('group=conditions&section=partner&seat=BP:OG');
    expect(section(partners, 'partners') ?? '').not.toMatch(/\d+ breaks?|>Breaks</);
  });

  test('three tab levels, each in the URL (owner decision 19)', () => {
    const tabsOf = (html: string) =>
      [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
    const first = tabsOf(render(''));
    for (const tab of [
      'Speaking',
      'Judging',
      'Results (team)',
      'Speaks (you)',
      'Conditions',
      'Team placement',
      'Breaks',
      'Straights &amp; firsts',
    ]) {
      expect(first, tab).toContain(tab);
    }
    expect(tabsOf(render('group=conditions'))).toContain('By motion type');
    // Seasons is gone (owner, 2026-10-29): the Record's yearly charts carry it.
    expect(section(render(''), 'seasons')).toBeNull();
    // The starting tab comes from the URL.
    expect(render('role=judging')).toMatch(/role="tab" [^>]*aria-selected="true"[^>]*>Judging</);
  });

  test('a seat keeps the delta it has on the whole record — the baseline is never the filtered slice', () => {
    const at = 'group=conditions&section=position';
    const unfiltered = rowText(section(render(at), 'positions')!, 'OG');
    const filtered = rowText(section(render(`${at}&seat=BP:OG`), 'positions')!, 'OG');
    expect(unfiltered).not.toBeNull();
    expect(filtered).toBe(unfiltered);
  });

  test('a speaking filter that matches nothing still leaves judging whole', () => {
    expect(render('partner=p-nobody')).toContain('No rounds match these filters');
    const judging = render('partner=p-nobody&role=judging');
    expect(section(judging, 'judging-outrounds')).not.toBeNull();
  });

  test('the new slots of decision 19 are present (part 2)', () => {
    const tabsOf = (html: string) =>
      [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(tabsOf(render('group=speaks'))).toContain('Top-10 finishes');
    const judging = tabsOf(render('role=judging'));
    for (const tab of ['Outrounds judged', 'Chairing', 'Core roles'])
      expect(judging, tab).toContain(tab);
    expect(tabsOf(render('role=judging&group=conditions'))).toContain('By stage');
    for (const [q, id] of [
      ['group=speaks&section=top-finishes', 'top-finishes'],
      ['role=judging&section=chairing', 'judging-chair'],
      ['role=judging&section=core', 'judging-roles'],
      ['role=judging&group=conditions&section=format', 'judging-format'],
      ['role=judging&group=conditions&section=stage', 'judging-stage'],
    ]) {
      expect(section(render(q), id), id).not.toBeNull();
    }
  });

  test('partners filter by person key', () => {
    const html = render('partner=p-Ann');
    expect(html).toMatch(/2 of 3 tournaments/);
  });
});
