import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// R12: the shared view behind "Fill years from names" and "Refresh
// old-parser tournaments", rendered in each state (there is no DOM runner).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { BulkFillView } = await import('@/components/admin/BulkFill');
const { YEAR_WORDS } = await import('@/components/admin/FillYearsButton');
const { OLD_PARSER_WORDS } = await import('@/components/admin/RefreshOldParserButton');
const { yearFillSummary } = await import('@/lib/admin/yearFillText');
const { oldParserSummary } = await import('@/lib/admin/oldParserText');

type Y = { filled: number; noYear: number; left: number; next: string | null };
type O = { refreshed: number; failed: number; left: number; next: string | null };

const years = (over: Partial<Parameters<typeof BulkFillView<Y>>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(BulkFillView<Y>, {
      waiting: 120,
      words: YEAR_WORDS,
      pending: false,
      error: null,
      result: null,
      summary: yearFillSummary,
      onRun: () => {},
      ...over,
    }),
  );
const old = (over: Partial<Parameters<typeof BulkFillView<O>>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(BulkFillView<O>, {
      waiting: 45,
      words: OLD_PARSER_WORDS,
      pending: false,
      error: null,
      result: null,
      summary: oldParserSummary,
      onRun: () => {},
      ...over,
    }),
  );

describe('Fill years from names', () => {
  it('idle: the count and a 50-at-a-time button', () => {
    const html = years();
    expect(html).toContain('120');
    expect(html).toContain('>Fill years from names<');
    expect(html).toContain('50 at a time');
  });
  it('after a batch: the stated summary line, and the button continues', () => {
    const html = years({ result: { filled: 12, noYear: 3, left: 40, next: '9' } });
    expect(html).toContain('Filled 12 · no year in name 3 · 40 left');
    expect(html).toContain('>Fill the next 50<');
  });
  it('with none waiting, says why there is no button', () => {
    const html = years({ waiting: 0 });
    expect(html).toContain('Every stored tournament has a year.');
    expect(html).not.toContain('<button');
  });
});

describe('Refresh old-parser tournaments', () => {
  it('idle: the count and a 20-at-a-time button', () => {
    const html = old();
    expect(html).toContain('>Refresh old-parser tournaments<');
    expect(html).toContain('20 at a time');
  });
  it('pending: a status line that says it can take a minute', () => {
    const html = old({ pending: true });
    expect(html).toContain('Re-reading every recorded page of up to 20 tournaments.');
    expect(html).toContain('Refreshing…');
  });
  it('after a batch: the summary, and the outcome stays when none are left', () => {
    const html = old({ result: { refreshed: 18, failed: 2, left: 0, next: null } });
    expect(html).toContain('Refreshed 18 · failed 2 · 0 left');
    expect(html).not.toContain('<button');
  });
  it('shows a failure as an alert', () => {
    expect(old({ error: 'Request failed.' })).toContain('role="alert"');
  });
});
