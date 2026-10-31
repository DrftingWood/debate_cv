import { describe, expect, it } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SummaryLine } from '@/components/admin/SummaryLine';
import { LookupResultView } from '@/components/admin/LookupResult';

(globalThis as { React?: typeof React }).React = React;

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

describe('SummaryLine', () => {
  it('shows a dash for each figure whose read failed', () => {
    const out = text(
      renderToStaticMarkup(
        createElement(SummaryLine, {
          summary: { needsYou: null, accuracy: null, importsFailing: null, queue: null },
        }),
      ),
    );
    expect(out).toBe(
      'Needs you — · Accuracy — · Imports to review — · Queue — · Counts unavailable',
    );
  });

  it('does not say counts are unavailable when every read worked', () => {
    const out = text(
      renderToStaticMarkup(
        createElement(SummaryLine, {
          summary: {
            needsYou: 3,
            accuracy: { score: 90, good: 5, check: 1, rescrape: 0 },
            importsFailing: 1,
            queue: 0,
          },
        }),
      ),
    );
    expect(out).not.toContain('unavailable');
  });
});

describe('LookupResultView, epoch marker', () => {
  it('says a re-scrape is queued and never prints 1970', () => {
    const out = renderToStaticMarkup(
      createElement(LookupResultView, {
        now: new Date('2026-10-31T12:00:00Z'),
        result: {
          kind: 'stored',
          id: '5',
          name: 'Oxford IV 2025',
          publicUrl: null,
          scrapedAt: new Date(0).toISOString(),
          parserCurrent: true,
          score: 92,
          band: 'good',
          partlyLoaded: false,
        },
      }),
    );
    expect(out).toContain('Re-scrape queued');
    expect(out).not.toContain('1970');
  });
});
