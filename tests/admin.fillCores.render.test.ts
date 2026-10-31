import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task R10: "Fill missing adjudication cores" on the Tools tab, rendered in
// each state (there is no DOM runner).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { FillCoresView } = await import('@/components/admin/FillCoresButton');

const view = (over: Partial<Parameters<typeof FillCoresView>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(FillCoresView, {
      missing: 250,
      pending: false,
      error: null,
      result: null,
      onRun: () => {},
      ...over,
    }),
  );

describe('<FillCoresView>', () => {
  it('idle: the count, and a button that says one press goes over 20', () => {
    const html = view();
    expect(html).toContain('250');
    expect(html).toContain('>Fill missing adjudication cores<');
    expect(html).toContain('20 at a time');
    expect(html).toMatch(/<p[^>]*role="status"[^>]*><\/p>/);
  });

  it('pending: a status line while the batch runs, and the button is busy', () => {
    const html = view({ pending: true });
    expect(html).toContain('Reading the home pages of up to 20 tournaments.');
    expect(html).toContain('Reading…');
  });

  it('after a batch: the four counts in the stated order, and the button continues', () => {
    const html = view({ result: { found: 12, none: 3, failed: 1, left: 40, next: '500' } });
    expect(html).toContain('Found 12 · none named 3 · failed 1 · 40 left');
    expect(html).toContain('>Fill the next 20<');
  });

  it('with none waiting, says why there is nothing to press', () => {
    const html = view({ missing: 0 });
    expect(html).toContain('Every tournament already names a core or has been read.');
    expect(html).not.toContain('<button');
  });

  it('when a batch ends with none left, the outcome stays and no button remains', () => {
    const html = view({ result: { found: 3, none: 1, failed: 0, left: 0, next: null } });
    expect(html).toContain('Found 3');
    expect(html).not.toContain('<button');
  });

  it('a refusal stays as an alert', () => {
    const html = view({ error: 'Something went wrong on our side. Try again in a minute.' });
    expect(html).toContain('role="alert"');
  });
});
