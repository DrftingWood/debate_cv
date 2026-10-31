import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { foldBalance, orderSeats } from '@/lib/admin/capturedMath';
import type { BalanceStats } from '@/lib/admin/captured';

(globalThis as { React?: typeof React }).React = React;
vi.mock('@/lib/db', () => ({ prisma: {} }));
const { BalanceBody } = await import('@/components/admin/CapturedBalance');

/**
 * R7 follow-up (browser check at 390 px): the "Most unbalanced" tables clipped
 * their Spread column and wrapped each motion over six lines. Below md each row
 * is a card: the motion (two lines, whole text in the title), its tournament
 * with the Tab link, then "Spread · round · seats" with the seats in the fixed
 * order OG OO CG CO (the database sorts them alphabetically).
 */
const seat = (position: string, n: number, sum: number) => ({
  position,
  rows: n,
  pointsRows: n,
  pointsSum: sum,
  winRows: 0,
  winSum: 0,
});
const long = 'This House believes that the long motion text goes on and on and on '
  .repeat(3)
  .trim();
const balance: BalanceStats = {
  overall: foldBalance([
    seat('OG', 100, 170),
    seat('OO', 100, 150),
    seat('CG', 100, 140),
    seat('CO', 100, 140),
  ]),
  noSides: 0,
  byType: { shown: [], tooFew: [] },
  unbalancedBp: [
    {
      motionId: '77',
      text: long,
      roundLabel: 'R3',
      tournament: { id: '5', name: 'Oxford IV', tabUrl: 'https://ox.calicotab.com/ox/' },
      spread: 1.5,
      rooms: 12,
      // As the SQL returns them: alphabetical.
      seats: [
        { pos: 'CG', value: 0.8 },
        { pos: 'CO', value: 1.2 },
        { pos: 'OG', value: 2.3 },
        { pos: 'OO', value: 1.7 },
      ],
    },
  ],
  unbalancedTwo: [
    {
      motionId: '78',
      text: 'THW ban zoos',
      roundLabel: 'R2',
      tournament: { id: '6', name: 'Cam IV', tabUrl: null },
      spread: 0.2,
      rooms: 9,
      seats: [
        { pos: 'Opp', value: 0.3 },
        { pos: 'Prop', value: 0.7 },
      ],
    },
  ],
};
const html = renderToStaticMarkup(React.createElement(BalanceBody, { balance }));
const plain = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('seat order', () => {
  it('is OG OO CG CO, then Prop Opp', () => {
    expect(
      orderSeats([{ pos: 'CO' }, { pos: 'OO' }, { pos: 'CG' }, { pos: 'OG' }]).map((s) => s.pos),
    ).toEqual(['OG', 'OO', 'CG', 'CO']);
    expect(orderSeats([{ pos: 'Opp' }, { pos: 'Prop' }]).map((s) => s.pos)).toEqual([
      'Prop',
      'Opp',
    ]);
  });
});

describe('the unbalanced motions below md', () => {
  it('are cards: clamped text with the whole text in the title, tournament and Tab, one detail line', () => {
    expect(html).toContain('md:hidden');
    expect(html).toContain('line-clamp-2');
    expect(html).toContain(`title="${long}"`);
    expect(plain(html)).toContain(
      'Spread 1.50 · R3 · 12 rooms · OG 2.30 · OO 1.70 · CG 0.80 · CO 1.20',
    );
    expect(plain(html)).toContain('Spread 20.0%');
  });
  it('keep the table from md up, seats in the fixed order too', () => {
    expect(html).toContain('hidden md:block');
    expect(plain(html)).toMatch(/R3 · OG 2\.30 · OO 1\.70 · CG 0\.80 · CO 1\.20/);
    expect(plain(html)).toContain('Prop 70.0% · Opp 30.0%');
  });
});

describe('the by-type tables below md', () => {
  const withTypes: BalanceStats = {
    ...balance,
    byType: {
      shown: [
        {
          type: 'THW',
          balance: foldBalance([
            ...['OG', 'OO', 'CG', 'CO'].map((p) => seat(p, 40, 60)),
            { position: 'Prop', rows: 40, pointsRows: 0, pointsSum: 0, winRows: 40, winSum: 20 },
            { position: 'Opp', rows: 40, pointsRows: 0, pointsSum: 0, winRows: 40, winSum: 20 },
          ]),
        },
      ],
      tooFew: [],
    },
  };
  const out = renderToStaticMarkup(React.createElement(BalanceBody, { balance: withTypes }));
  it('drop the Rooms column (col, header and cell together) and say the rooms under the type', () => {
    expect(out).toContain('hidden md:table-column');
    expect(out).toContain('hidden md:table-cell');
    expect(plain(out)).toContain('≈ 40 rooms');
    expect(out).toContain('md:hidden');
  });
});
