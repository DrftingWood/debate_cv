/**
 * The redesign primitives (Tabs, Tooltip, CareerChart) rendered to static
 * HTML. Keyboard behaviour needs a browser and was checked in one; these pin
 * the markup contracts a later page rebuild relies on: the APG tab wiring
 * and URL helpers (UX-59, UX-60), the tooltip staying out of the
 * accessibility tree, and the chart's link names and numbers table (UX-32).
 */
import { describe, expect, it } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs } from '@/components/ui/Tabs';
import { Tooltip } from '@/components/ui/Tooltip';
import { CareerChart } from '@/components/ui/CareerChart';
import { speakingSeries } from '@/lib/cv/careerChart';
import { resolveTab, urlWithTab } from '@/lib/utils/tabParam';

(globalThis as { React?: typeof React }).React = React;

const items = [
  { value: 'speaking', label: 'Speaking', panel: createElement('p', null, 'S-panel') },
  { value: 'judging', label: 'Judging', panel: createElement('p', null, 'J-panel') },
];

describe('resolveTab / urlWithTab', () => {
  const tabs = ['speaking', 'judging'] as const;
  it('takes a known value from the URL and falls back otherwise', () => {
    expect(resolveTab('judging', tabs, 'speaking')).toBe('judging');
    expect(resolveTab(['judging', 'x'], tabs, 'speaking')).toBe('judging');
    expect(resolveTab('bogus', tabs, 'speaking')).toBe('speaking');
    expect(resolveTab(undefined, tabs, 'speaking')).toBe('speaking');
  });
  it('keeps other parameters and drops the default', () => {
    expect(
      urlWithTab(
        { pathname: '/cv/stats', search: '?year=2025' },
        { param: 'role', value: 'judging', fallback: 'speaking' },
      ),
    ).toBe('/cv/stats?year=2025&role=judging');
    expect(
      urlWithTab(
        { pathname: '/cv/stats', search: '?role=judging&year=2025' },
        { param: 'role', value: 'speaking', fallback: 'speaking' },
      ),
    ).toBe('/cv/stats?year=2025');
    expect(
      urlWithTab(
        { pathname: '/cv/stats', search: '' },
        { param: 'role', value: 'speaking', fallback: 'speaking' },
      ),
    ).toBe('/cv/stats');
  });
});

describe('Tabs', () => {
  it('wires one selected, focusable tab to its visible panel', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        label: 'Statistics by role',
        param: 'role',
        items,
        initialValue: 'judging',
      }),
    );
    expect(html).toContain('role="tablist" aria-label="Statistics by role"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>Judging/);
    expect(html).toMatch(/aria-selected="false"[^>]*tabindex="-1"[^>]*>Speaking/);
    expect(html).toMatch(/role="tabpanel"[^>]*hidden=""[^>]*><p>S-panel/);
    expect(html).toMatch(/role="tabpanel"(?![^>]*hidden)[^>]*><p>J-panel/);
  });

  it('falls back to the first tab for an unknown value', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, { label: 'Role', param: 'role', items, initialValue: 'nope' }),
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>Speaking/);
  });

  it('gives a vertical list a labelled select for phones', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        label: 'Sections',
        param: 'section',
        items,
        orientation: 'vertical',
        phoneSelect: true,
      }),
    );
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toMatch(/<label[^>]*>.*Section.*<select/);
  });
});

describe('Tooltip', () => {
  it('is a visual copy only, hidden from assistive tech', () => {
    const html = renderToStaticMarkup(
      createElement(
        Tooltip,
        // children go as the third argument (react/no-children-prop); the cast
        // only tells TypeScript that the required prop arrives that way.
        { content: 'Notifications' } as React.ComponentProps<typeof Tooltip>,
        createElement('button', { type: 'button', 'aria-label': 'Notifications' }),
      ),
    );
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>.*Notifications/);
  });
});

describe('CareerChart', () => {
  const series = speakingSeries([
    {
      tournamentName: 'Australs 2024',
      year: 2024,
      broke: true,
      eliminationReached: 'Semifinals',
      eliminationReachedByCategory: null,
      wonTournament: null,
      speakerRankOpen: 7,
      speakerRankEsl: null,
      speakerRankEfl: null,
    },
    {
      tournamentName: 'City Open 2025',
      year: 2025,
      broke: false,
      eliminationReached: null,
      eliminationReachedByCategory: null,
      wonTournament: null,
      speakerRankOpen: null,
      speakerRankEsl: null,
      speakerRankEfl: null,
    },
  ]);

  it('names each year link with its counts and links it to the ledger year', () => {
    const html = renderToStaticMarkup(
      createElement(CareerChart, { kind: 'speaking', title: 'Speaking, by year', series }),
    );
    expect(html).toContain(
      'href="#y2024" aria-label="2024: 1 tournament, 1 semifinals, 1 major, 1 top-10 speaker finish. Go to 2024."',
    );
    expect(html).toContain('<caption class="sr-only">Speaking, by year, in numbers</caption>');
  });

  it('renders the compact form without links, with a text alternative', () => {
    const html = renderToStaticMarkup(
      createElement(CareerChart, { kind: 'speaking', title: 'Sample', series, compact: true }),
    );
    expect(html).not.toContain('<a ');
    expect(html).toContain('2 tournaments from 2024 to 2025, 1 with a break.');
  });
});
