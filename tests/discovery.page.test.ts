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
import { buildRows, type Appearance } from '@/lib/discovery/match';

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
    alias: 'Abhishek Acharya',
    matchKind: 'exact',
    roles: ['speaker'],
    teamName: 'Ashoka A',
    mine: false,
    slots: [],
    eudc: false,
    teammates: [{ name: 'Priya Rao', where: 'SIDO 2025', sameTeam: true }],
    ...over,
  };
}

function input(over: Partial<FoundInput> = {}): FoundInput {
  const rows = buildRows(
    [app(), app({ tournamentId: '11', tournamentName: 'Oxford IV', teammates: [] })],
    new Map(),
  );
  return {
    aliasCount: 1,
    unsearchable: 0,
    overLimit: 0,
    capped: [],
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

  it('loads for the session user only (never a typed or Google name), under a budget', async () => {
    await render();
    expect(loadFoundMock).toHaveBeenCalledWith('user-1', { signal: expect.any(AbortSignal) });
  });
});

describe('/cv/found list', () => {
  it('has one h1 and one list, with no tiers', async () => {
    const out = await render();
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('Tournaments that may be yours');
    expect(out).toContain('Tournaments listing your name (2)');
    expect(out).not.toMatch(/Strong matches|Possible matches/);
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
      'Why this match: </span>Exact match · your teammate Priya Rao (SIDO 2025) is on this team · Europe, 2024',
    );
    expect(out).not.toContain('title="');
  });

  it('answers are per row (no bulk action) and there is one live region', async () => {
    const out = await render();
    expect(out).not.toContain('Review all');
    expect(out.match(/bg-primary text-primary-foreground/g)).toBeNull();
    expect(out.match(/role="status"/g)).toHaveLength(1);
  });

  it('says plainly when a name had too many matches, instead of truncating silently', async () => {
    const out = await render(
      OWNER,
      input({ capped: [{ name: 'Abhishek', total: 640, shown: 200 }] }),
    );
    expect(out).toContain('Too many matches for “Abhishek”: 640');
    expect(out).toContain('showing the first 200');
  });
});

describe('/cv/found empty states', () => {
  it('no claimed names: points to the profile to claim them', async () => {
    const out = await render(OWNER, input({ aliasCount: 0, rows: [] }));
    expect(out).toContain('Nothing to search with yet');
    expect(out).toContain('Settings under Profile');
    expect(out).toContain('href="/settings/profile"');
  });

  it('a name in a script we cannot search yet says so', async () => {
    const out = await render(OWNER, input({ aliasCount: 0, unsearchable: 1, rows: [] }));
    expect(out).toContain('We cannot search for your name yet');
  });

  it('zero matches', async () => {
    const out = await render(OWNER, input({ rows: [] }));
    expect(out).toContain('No other tabs list your name');
  });
});

describe('/cv/found when the search is slow or fails', () => {
  async function renderWith(email: string, impl: () => Promise<unknown>) {
    authMock.mockResolvedValue({ user: { id: 'user-1', email, name: 'Abhishek Acharya' } });
    loadFoundMock.mockImplementation(impl);
    return renderToStaticMarkup(await FoundPage());
  }

  it('past the time budget: a "taking too long" state with a retry link, not a spinner', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const page = renderWith(OWNER, () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(12_001);
      const out = await page;
      expect(out).toContain('This is taking too long');
      expect(out).toContain('href="/cv/found"');
      expect(out).toContain('Tournaments that may be yours');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('a missing table (migration not run) tells the admin plainly, without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('The table `public.AppearanceCandidate` does not exist'), {
      code: 'P2021',
    });
    const out = await renderWith(OWNER, () => Promise.reject(err));
    expect(out).toContain('We could not search right now');
    expect(out).toContain('a migration has probably not run');
    expect(out).toContain('AppearanceCandidate');
    vi.restoreAllMocks();
  });

  it('a non-admin tester sees plain words, not the database detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.DISCOVERY_LIST_EMAILS = 'tester@example.com';
    const out = await renderWith('tester@example.com', () =>
      Promise.reject(new Error('connection reset')),
    );
    expect(out).toContain('We could not search right now');
    expect(out).not.toContain('connection reset');
    expect(out).toContain('Try again');
    vi.restoreAllMocks();
  });
});
