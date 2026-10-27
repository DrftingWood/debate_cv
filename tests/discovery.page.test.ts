/**
 * /cv/found rendered to static HTML with the session and the loader mocked:
 * the flag gate (404 for everyone without it), the empty states, and the
 * markup rules the page owes the UX standards (row headers, row-named
 * buttons, visible evidence, one primary action, one live region).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FoundInput } from '@/lib/discovery/view';
import { rankAppearances, type Appearance } from '@/lib/discovery/match';

(globalThis as { React?: typeof React }).React = React;

const authMock = vi.fn();
const loadFoundMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/discovery/loader', () => ({ loadFound: loadFoundMock }));
vi.mock('@/components/CvSubNav', () => ({ CvSubNav: () => null }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { default: FoundPage } = await import('@/app/(app)/cv/found/page');

const OWNER = 'owner@example.com';

function app(over: Partial<Appearance> = {}): Appearance {
  return {
    tournamentId: '10',
    personId: '100',
    tournamentName: 'WUDC 2024',
    year: 2024,
    region: 'Europe',
    publicUrl: 'https://wudc2024.calicotab.com/wudc2024/',
    listedName: 'Abhishek Acharya',
    roles: ['speaker'],
    teamName: 'Ashoka A',
    claimedBy: null,
    slots: [],
    eudc: false,
    teammates: [{ name: 'Priya Rao', where: 'SIDO 2025', sameTeam: true }],
    busiestYear: null,
    ...over,
  };
}

function input(over: Partial<FoundInput> = {}): FoundInput {
  const rows = rankAppearances(
    [app(), app({ tournamentId: '11', tournamentName: 'Oxford IV', teammates: [] })],
    {
      anchors: ['Abhishek Acharya'],
      userYears: [2024],
      userRegions: [],
      decisions: new Map(),
    },
  );
  return {
    anchorCount: 1,
    unsearchable: 0,
    heldBack: 0,
    truncated: false,
    rows,
    stored: [],
    ...over,
  };
}

async function render(email = OWNER, data: FoundInput = input()) {
  authMock.mockResolvedValue({ user: { id: 'user-1', email, name: 'Abhishek Acharya' } });
  loadFoundMock.mockResolvedValue({ input: data, rows: data.rows });
  return renderToStaticMarkup(await FoundPage());
}

beforeEach(() => {
  authMock.mockReset();
  loadFoundMock.mockReset();
  process.env.ADMIN_EMAIL = OWNER;
  delete process.env.DISCOVERY_LIST;
  delete process.env.DISCOVERY_LIST_EMAILS;
});

describe('/cv/found gate', () => {
  it('404s for a user without the flag, without loading anything', async () => {
    await expect(render('someone@example.com')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loadFoundMock).not.toHaveBeenCalled();
  });

  it('404s for the owner under the kill switch', async () => {
    process.env.DISCOVERY_LIST = 'off';
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends a signed-out visitor home', async () => {
    authMock.mockResolvedValue(null);
    await expect(FoundPage()).rejects.toThrow('redirect /');
  });

  it('seeds from the session but passes the Google name only as a reference', async () => {
    await render();
    expect(loadFoundMock).toHaveBeenCalledWith('user-1', 'Abhishek Acharya');
  });
});

describe('/cv/found list', () => {
  it('has one h1 and the tiers as h2', async () => {
    const out = await render();
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('Tournaments that may be yours');
    expect(out).toContain('Strong matches (1)');
    expect(out).toContain('Possible matches (1)');
  });

  it('names each row in a header cell and each button for its row', async () => {
    const out = await render();
    expect(out).toContain('<th scope="row"');
    expect(out).toContain('aria-label="This is me: WUDC 2024"');
    expect(out).toContain('aria-label="Not me: Oxford IV 2024"');
    expect(out).toContain('(opens in new tab)');
  });

  it('shows the "Why this match" line in text, not on hover', async () => {
    const out = await render();
    expect(out).toContain(
      'Why this match: </span>Same name · your teammate Priya Rao (SIDO 2025) is on this team · Europe, 2024',
    );
    expect(out).not.toContain('title="');
  });

  it('has exactly one primary action (the bulk review) and one live region', async () => {
    const out = await render();
    expect(out).toContain('Review all 1 strong matches');
    expect(out.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(out.match(/role="status"/g)).toHaveLength(1);
  });

  it('shows the held-back count to an admin only', async () => {
    const data = input({ heldBack: 1 });
    expect(await render(OWNER, data)).toContain('Admin: 1 registration name is held back');
    process.env.DISCOVERY_LIST_EMAILS = 'tester@example.com';
    expect(await render('tester@example.com', data)).not.toContain('held back');
  });
});

describe('/cv/found empty states', () => {
  it('no names to search with: points to Imports', async () => {
    const out = await render(OWNER, input({ anchorCount: 0, rows: [] }));
    expect(out).toContain('Nothing to search with yet');
    expect(out).toContain('href="/dashboard"');
  });

  it('a name in a script we cannot search yet says so', async () => {
    const out = await render(OWNER, input({ anchorCount: 0, unsearchable: 1, rows: [] }));
    expect(out).toContain('We cannot search for your name yet');
  });

  it('zero matches', async () => {
    const out = await render(OWNER, input({ rows: [] }));
    expect(out).toContain('No other tabs list your name');
  });
});
