import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// R12: the detail page's ignore control, rendered in each state (there is no
// DOM runner).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { IgnoreTournamentView } = await import('@/components/admin/IgnoreTournament');

const view = (over: Partial<Parameters<typeof IgnoreTournamentView>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(IgnoreTournamentView, {
      tournamentName: 'minimal8team',
      ignored: false,
      looksLikeTest: false,
      pending: false,
      error: null,
      onRun: () => {},
      ...over,
    }),
  );

describe('<IgnoreTournamentView>', () => {
  it('not ignored: offers "Ignore in admin stats" and says the CV keeps it', () => {
    const html = view();
    expect(html).toContain('>Ignore in admin stats<');
    expect(html).toContain('It stays on any CV that has it.');
    expect(html).not.toContain('looks like a test');
  });

  it('suggests ignoring a test-looking name, without ignoring it', () => {
    const html = view({ looksLikeTest: true });
    expect(html).toContain('The name looks like a test tournament.');
    expect(html).toContain('>Ignore in admin stats<');
  });

  it('ignored: offers "Stop ignoring" and drops the suggestion', () => {
    const html = view({ ignored: true, looksLikeTest: true });
    expect(html).toContain('>Stop ignoring<');
    expect(html).toContain('This tournament is ignored');
    expect(html).not.toContain('looks like a test');
  });

  it('shows a refusal as an alert', () => {
    expect(view({ error: 'Request failed.' })).toContain('role="alert"');
  });
});
