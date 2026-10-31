import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { getTournamentStaff } from '@/lib/admin/tournamentStaff';
import { StaffNames } from '@/components/admin/StaffNames';

// R10 ruling 17(8): the admin tournament page lists the staff-block names and
// says, in words beside a symbol, how each was matched.

beforeEach(() => resetPrismaMock());

describe('getTournamentStaff', () => {
  it('reads the core names with the exact link or the candidate, exact first', async () => {
    prismaMock.tournamentStaff.findMany.mockResolvedValue([
      { name: 'Ada Lovelace', person: { displayName: 'Ada Lovelace' }, candidate: null },
      { name: 'Rahul Sharma', person: null, candidate: { displayName: 'Rahul Kumar Sharma' } },
      { name: 'Apratim', person: null, candidate: null },
    ]);
    expect(await getTournamentStaff(7n)).toEqual([
      { name: 'Ada Lovelace', state: 'linked', person: 'Ada Lovelace' },
      { name: 'Rahul Sharma', state: 'possible', person: 'Rahul Kumar Sharma' },
      { name: 'Apratim', state: 'none', person: null },
    ]);
    expect(prismaMock.tournamentStaff.findMany.mock.calls[0]![0].where).toEqual({
      tournamentId: 7n,
      role: 'core',
    });
  });
});

describe('<StaffNames>', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffNames, {
      rows: [
        { name: 'Ada Lovelace', state: 'linked', person: 'Ada Lovelace' },
        { name: 'Rahul Sharma', state: 'possible', person: 'Rahul Kumar Sharma' },
        { name: 'Apratim', state: 'none', person: null },
      ],
    }),
  );

  it('marks each name with a symbol and the words', () => {
    expect(html).toContain('Linked to Ada Lovelace');
    expect(html).toContain('Possible match: Rahul Kumar Sharma');
    expect(html).toContain('Not linked');
    // The symbol is decoration: three icons, all hidden from assistive tech.
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(3);
  });

  it('carries no link and no private URL', () => {
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
    expect(html.toLowerCase()).not.toContain('privateurls');
  });

  it('with no names says why, and where to read them', () => {
    const empty = renderToStaticMarkup(React.createElement(StaffNames, { rows: [] }));
    expect(empty).toContain('No names stored.');
    expect(empty).toContain('Fill missing adjudication cores');
  });
});
