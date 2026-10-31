import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task R9: "Infer format" on the check and "Fill missing formats" on the
// Tools tab, rendered in each state (there is no DOM runner).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { InferFormatView } = await import('@/components/admin/InferFormatButton');
const { FillFormatsView } = await import('@/components/admin/FillFormatsButton');
const { fillSummary, inferredWords, UNDECIDED_WORDS } = await import('@/lib/admin/formatFillText');
const { formatFailureMessage } = await import('@/lib/admin/actionMessage');

const PIECES = [
  {
    kind: 'round' as const,
    key: '1',
    label: 'R1',
    url: 'https://t.calicotab.com/t/results/round/1/',
  },
  { kind: 'team' as const, key: '', label: 'Team tab', url: null },
];
const infer = (over: Partial<Parameters<typeof InferFormatView>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(InferFormatView, {
      tournamentId: '7',
      tournamentName: 'Oxford IV',
      pieces: PIECES,
      pending: false,
      error: null,
      undecided: false,
      onRun: () => {},
      ...over,
    }),
  );

describe('<InferFormatView>', () => {
  it('idle: a Fix button named for the tournament, an empty status line, no re-scrape', () => {
    const html = infer();
    expect(html).toContain('aria-label="Fix: infer the format of Oxford IV"');
    expect(html).toContain('>Fix<');
    expect(html).toMatch(/<p[^>]*role="status"[^>]*><\/p>/);
    expect(html).not.toContain('Re-scrape');
  });

  it('pending: says what it is doing and the button is busy', () => {
    const html = infer({ pending: true });
    expect(html).toContain('Reading the format of Oxford IV from the stored rounds.');
    expect(html).toContain('Inferring…');
  });

  it('undecided: says why in words and offers the re-scrape of R1 and the team tab', () => {
    const html = infer({ undecided: true });
    expect(html).toContain(UNDECIDED_WORDS.replace("'", '&#x27;'));
    expect(html).toContain('Re-scrape suggested (2)');
  });

  it('a refusal stays as an alert', () => {
    const html = infer({ error: 'Something went wrong on our side. Try again in a minute.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Try again in a minute.');
  });
});

describe('<FillFormatsView>', () => {
  const fill = (over: Partial<Parameters<typeof FillFormatsView>[0]> = {}) =>
    renderToStaticMarkup(
      React.createElement(FillFormatsView, {
        missing: 120,
        pending: false,
        error: null,
        result: null,
        onRun: () => {},
        ...over,
      }),
    );

  it('idle: the count, and a button that says one press goes over 50', () => {
    const html = fill();
    expect(html).toContain('120');
    expect(html).toContain('>Fill missing formats<');
    expect(html).toContain('50 at a time');
  });

  it('pending: a status line while the batch runs', () => {
    const html = fill({ pending: true });
    expect(html).toContain('Reading the formats of up to 50 tournaments.');
    expect(html).toContain('Filling…');
  });

  it('after a batch: the three counts, and the button continues', () => {
    const html = fill({ result: { filled: 40, undecided: 10, left: 70, next: '500' } });
    expect(html).toContain('Filled 40 · couldn&#x27;t decide 10 · 70 left');
    expect(html).toContain('>Fill the next 50<');
  });

  it('with none missing, says why there is nothing to press', () => {
    const html = fill({ missing: 0 });
    expect(html).toContain('Every stored tournament has a format.');
    expect(html).not.toContain('<button');
  });

  it('when a batch ends with none left, no button remains', () => {
    const html = fill({ result: { filled: 3, undecided: 1, left: 0, next: null } });
    expect(html).toContain('Filled 3');
    expect(html).not.toContain('<button');
  });
});

describe('words', () => {
  it('fillSummary and inferredWords', () => {
    expect(fillSummary({ filled: 1, undecided: 2, left: 3, next: null })).toBe(
      "Filled 1 · couldn't decide 2 · 3 left",
    );
    expect(inferredWords('Australs')).toBe('Format set to Australs.');
    expect(inferredWords(null)).toBe('This tournament already has a format.');
  });
  it('formatFailureMessage words the route codes', () => {
    expect(formatFailureMessage({ status: 404, error: 'not_found' })).toContain('no longer exists');
    expect(formatFailureMessage({ status: 403, error: 'forbidden' })).toContain('not an admin');
  });
});
