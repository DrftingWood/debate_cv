/**
 * The shared tournament card and link (components/TournamentCard.tsx), which
 * /cv renders below `md` and the public CV reuses. What these pin is what the
 * 2026-10-27 audit found broken (CV-1, CV-3): names cut to an ellipsis with
 * the full text only in a hover `title`, and links that open a new tab
 * without saying so.
 */
import { describe, expect, it } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The components use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

const { TournamentCard, TournamentLink } = await import('@/components/TournamentCard');

const LONG = 'World Universities Debating Championship hosted in Panama City 2026';

describe('TournamentLink', () => {
  it('says it opens a new tab, visibly and to a screen reader', () => {
    const out = renderToStaticMarkup(
      createElement(TournamentLink, { name: 'Hart House IV', href: 'https://hh.calicotab.com/t/' }),
    );
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('<span class="sr-only"> (opens in new tab)</span>');
    // The icon is no longer hidden until hover.
    expect(out).not.toContain('opacity-0');
  });

  it('meets the 24 px target floor and never truncates', () => {
    const out = renderToStaticMarkup(
      createElement(TournamentLink, { name: LONG, href: 'https://x.calicotab.com/t/' }),
    );
    expect(out).toContain('min-h-6');
    expect(out).not.toContain('truncate');
    expect(out).not.toContain('title=');
    expect(out).toContain(LONG);
  });

  it('renders plain text without a URL', () => {
    const out = renderToStaticMarkup(
      createElement(TournamentLink, { name: 'Offline Open', href: null }),
    );
    expect(out).not.toContain('<a');
    expect(out).not.toContain('opens in new tab');
  });
});

describe('TournamentCard', () => {
  const html = (props: Partial<React.ComponentProps<typeof TournamentCard>> = {}) =>
    renderToStaticMarkup(
      createElement(TournamentCard, {
        name: LONG,
        href: 'https://wudc.calicotab.com/t/',
        year: 2026,
        fields: [
          { label: 'Team', value: 'Universidad Nacional Autónoma de México A' },
          { label: 'Partner', value: 'Alexandria Montgomery-Fitzwilliam, Second Person' },
          { label: 'Team rank', value: '#3 of 240', mono: true },
        ],
        ...props,
      }),
    );

  it('shows every name and field value in full, with no hover-only text', () => {
    const out = html();
    expect(out).toContain(LONG);
    expect(out).toContain('Universidad Nacional Autónoma de México A');
    expect(out).toContain('Alexandria Montgomery-Fitzwilliam, Second Person');
    expect(out).not.toContain('truncate');
    expect(out).not.toContain('title=');
    expect(out).toContain('break-words');
  });

  it('is a list item with the name as a heading, and the year beside it', () => {
    const out = html();
    expect(out.startsWith('<li class="panel p-4">')).toBe(true);
    expect(out).toMatch(/<h3[^>]*>.*World Universities/);
    expect(out).toContain('>2026<');
  });

  it('labels each fact in a definition list and sets figures in mono', () => {
    const out = html();
    expect(out).toContain('<dt class="data-label">Team rank</dt>');
    expect(out).toMatch(/<dd class="[^"]*\bnum\b[^"]*">#3 of 240<\/dd>/);
  });

  it('takes an outer element, heading level, result line and children', () => {
    const out = html({
      as: 'article',
      headingAs: 'h2',
      year: null,
      result: createElement('span', null, 'Semifinals'),
      children: createElement('p', null, 'extra'),
    });
    expect(out.startsWith('<article')).toBe(true);
    expect(out).toMatch(/<h2[^>]*>/);
    expect(out).toContain('>—<');
    expect(out).toContain('<span>Semifinals</span>');
    expect(out).toContain('<p>extra</p>');
  });

  it('omits the definition list when there are no fields', () => {
    expect(html({ fields: [] })).not.toContain('<dl');
  });
});
