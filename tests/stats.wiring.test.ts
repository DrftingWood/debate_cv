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
  test('every section id appears once, unfiltered and under a seat filter', () => {
    for (const q of ['', 'seat=BP:OG']) {
      const ids = sectionIds(render(q));
      expect(ids.length).toBeGreaterThan(5);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('a seat filter withholds tournament-level sections with a reason, keeping their slots', () => {
    const html = render('seat=BP:OG');
    // The slot stays (its tab is still there) and says why it is empty.
    for (const title of [
      'Team placement',
      'Breaks',
      'Speaker-tab placement',
      'Across a tournament',
    ]) {
      expect(html, title).toContain(`aria-label="${title}"`);
    }
    expect(html.match(/filtering by seat|seat filter/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    // Momentum and milestones follow whole tournaments: under a seat they are left out.
    expect(section(html, 'momentum')).toBeNull();
    expect(section(html, 'milestones')).toBeNull();
    // Teammates drops tournament breaks under a seat filter.
    expect(section(html, 'partners') ?? '').not.toMatch(/\d+ breaks?|>Breaks</);
  });

  test('three tab levels, each in the URL (owner decision 19)', () => {
    const html = render('');
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
    for (const tab of [
      'Speaking',
      'Judging',
      'Results (team)',
      'Speaks (you)',
      'Conditions',
      'Team placement',
      'Breaks',
      'Straights &amp; firsts',
      'By motion type',
    ]) {
      expect(tabs, tab).toContain(tab);
    }
    // Seasons is gone (owner, 2026-10-29): the Record's yearly charts carry it.
    expect(section(html, 'seasons')).toBeNull();
    // The starting tab comes from the URL.
    expect(render('role=judging')).toMatch(/role="tab" [^>]*aria-selected="true"[^>]*>Judging</);
  });

  test('a seat keeps the delta it has on the whole record — the baseline is never the filtered slice', () => {
    const unfiltered = rowText(section(render(''), 'positions')!, 'OG');
    const filtered = rowText(section(render('seat=BP:OG'), 'positions')!, 'OG');
    expect(unfiltered).not.toBeNull();
    expect(filtered).toBe(unfiltered);
  });

  test('a speaking filter that matches nothing still shows judging', () => {
    const html = render('partner=p-nobody');
    expect(html).toContain('No rounds match these filters');
    expect(section(html, 'judging-lens')).not.toBeNull();
  });

  test('partners filter by person key', () => {
    const html = render('partner=p-Ann');
    expect(html).toMatch(/2 of 3 tournaments/);
  });
});
