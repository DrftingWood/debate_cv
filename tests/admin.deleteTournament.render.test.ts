import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// The detail page's delete control, rendered in each state (there is no DOM
// runner).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { DeleteTournamentView } = await import('@/components/admin/DeleteTournament');

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
const view = (over: Partial<Parameters<typeof DeleteTournamentView>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(DeleteTournamentView, {
      tournamentName: 'DEMO',
      onCvs: 0,
      asking: false,
      pending: false,
      error: null,
      onAsk: () => {},
      onCancel: () => {},
      onRun: () => {},
      ...over,
    }),
  );

describe('DeleteTournamentView', () => {
  it('first offers only "Delete tournament", never the permanent button', () => {
    const out = view();
    expect(out).toContain('aria-label="Delete tournament: DEMO"');
    expect(out).not.toContain('Delete permanently');
  });
  it('asks on the page before deleting, with a way back', () => {
    const t = text(view({ asking: true }));
    expect(t).toContain('Delete DEMO? This cannot be undone');
    expect(t).toContain('Delete permanently');
    expect(t).toContain('Cancel');
  });
  it('deletes a tournament on CVs too, saying how many it comes off first', () => {
    expect(view({ onCvs: 2 })).toContain('aria-label="Delete tournament: DEMO"');
    const t = text(view({ onCvs: 2, asking: true }));
    expect(t).toContain('Delete DEMO? It comes off 2 users’ CVs. This cannot be undone');
    expect(t).toContain('Delete permanently');
    expect(text(view({ onCvs: 1, asking: true }))).toContain('It comes off one user’s CV.');
    expect(text(view({ onCvs: null, asking: true }))).toContain('Delete DEMO? This cannot');
  });
  it('keeps a refusal on screen as an alert tied to the button', () => {
    const out = view({ asking: true, error: 'Something went wrong on our side.' });
    expect(out).toMatch(/role="alert"/);
    expect(out).toMatch(/aria-describedby="[^"]+"/);
  });
});
