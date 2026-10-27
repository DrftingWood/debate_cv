import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicTournamentVisibility } from '@/components/PublicTournamentVisibility';

(globalThis as { React?: typeof React }).React = React;

const T = [
  { id: '1', name: 'Oxford IV', year: 2025 },
  { id: '2', name: 'EUDC', year: null },
];

describe('PublicTournamentVisibility (C101)', () => {
  it('checks shown tournaments and unchecks hidden ones', () => {
    const out = renderToStaticMarkup(
      React.createElement(PublicTournamentVisibility, {
        tournaments: T,
        hiddenIds: ['2'],
        onToggle: () => {},
      }),
    );
    expect(out).toMatch(/id="pub-t-1"[^>]*checked/);
    expect(out).not.toMatch(/id="pub-t-2"[^>]*checked/);
    expect(out).toContain('Oxford IV');
  });

  it('renders nothing when there are no tournaments', () => {
    const out = renderToStaticMarkup(
      React.createElement(PublicTournamentVisibility, {
        tournaments: [],
        hiddenIds: [],
        onToggle: () => {},
      }),
    );
    expect(out).toBe('');
  });
});
