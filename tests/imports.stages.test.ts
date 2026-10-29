/**
 * The Imports stage strip (ImportsStages; navigation change 2026-10-29):
 * four stages in pipeline order, one link each, the current view marked,
 * and failures as their own line rather than a fifth tile.
 */
import { describe, expect, it } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportsStages, type ImportCounts } from '@/components/ImportsStages';

(globalThis as { React?: typeof React }).React = React;

const counts = (over: Partial<ImportCounts> = {}): ImportCounts => ({
  all: 19,
  pending: 3,
  failed: 0,
  unmatched: 2,
  unavailable: 0,
  done: 14,
  ...over,
});

const render = (props: Partial<Parameters<typeof ImportsStages>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ImportsStages, { counts: counts(), view: null, discovery: false, ...props }),
  );

describe('ImportsStages', () => {
  it('lists the four stages in pipeline order, each one link', () => {
    const out = render();
    expect(out).toContain('<ol aria-label="Import stages"');
    const labels = [...out.matchAll(/class="truncate">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(['Sources', 'In progress', 'Review', 'On record']);
    expect(out.match(/<a /g)).toHaveLength(4);
    expect(out).toContain('href="/dashboard?stage=review"');
  });

  it('marks the current view, Review also for the Unmatched table', () => {
    expect(render({ view: 'review' })).toMatch(
      /aria-current="true"[^>]*href="\/dashboard\?stage=review"|href="\/dashboard\?stage=review"[^>]*aria-current="true"/,
    );
    expect(render({ view: 'unmatched' }).match(/aria-current="true"/g)).toHaveLength(1);
    expect(render().match(/aria-current/g)).toBeNull();
  });

  it('mentions public tabs under Review only with the discovery flag', () => {
    expect(render({ discovery: true })).toContain('found on public tabs');
    expect(render()).not.toContain('public tabs');
  });

  it('puts failures and dead links on their own line', () => {
    const out = render({ counts: counts({ failed: 2, unavailable: 5 }) });
    expect(out).toContain('href="/dashboard?filter=failed"');
    expect(out).toContain('2 failed');
    expect(out).toContain('5 links no longer load (dead, not retried).');
    expect(render()).not.toContain('filter=failed');
  });
});
