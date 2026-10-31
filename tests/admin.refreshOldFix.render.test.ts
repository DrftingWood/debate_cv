import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

// R12: the Fix for the Old parser finding, rendered in each state (there is
// no DOM runner).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { RefreshOldFixView } = await import('@/components/admin/RefreshOldFixButton');

const view = (over: Partial<Parameters<typeof RefreshOldFixView>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(RefreshOldFixView, {
      tournamentName: 'WUDC 2023',
      pending: false,
      error: null,
      incomplete: false,
      onRun: () => {},
      ...over,
    }),
  );

describe('<RefreshOldFixView>', () => {
  it('idle: a Fix button named for what it does', () => {
    const html = view();
    expect(html).toContain('>Fix<');
    expect(html).toContain('Fix: read every recorded page of WUDC 2023 again');
  });
  it('pending: a status line', () => {
    expect(view({ pending: true })).toContain('Reading every recorded page of WUDC 2023 again.');
  });
  it('incomplete: says nothing was recorded, without an alert', () => {
    const html = view({ incomplete: true });
    expect(html).toContain('Not every page could be read, so nothing was recorded.');
    expect(html).not.toContain('role="alert"');
  });
  it('a refused request is an alert', () => {
    expect(view({ error: 'Request failed.' })).toContain('role="alert"');
  });
});
