/**
 * The Imports Review stage (ImportsReview, holding the Found list that was
 * /cv/found until the 2026-10-29 navigation change) rendered to static HTML
 * with the loader mocked: the flag gate (no Found section, and no search,
 * without it), the name-claims half, the empty states, and the markup rules
 * the list owes the UX standards (row headers, row-named buttons, visible
 * evidence, one primary action, one live region).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FoundInput } from '@/lib/discovery/view';
import { buildRows, type Appearance } from '@/lib/discovery/match';

(globalThis as { React?: typeof React }).React = React;

// lib/admin reaches next-auth through lib/auth, which cannot load outside Next.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const loadFoundMock = vi.fn();
vi.mock('@/lib/discovery/loader', () => ({ loadFound: loadFoundMock }));

const { ImportsReview } = await import('@/components/ImportsReview');

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

async function review(email: string, unmatched = 0) {
  return renderToStaticMarkup(await ImportsReview({ userId: 'user-1', email, unmatched }));
}

async function render(email = OWNER, data: FoundInput = input()) {
  loadFoundMock.mockResolvedValue({ input: data, rows: data.rows });
  return review(email);
}

beforeEach(() => {
  loadFoundMock.mockReset();
  process.env.ADMIN_EMAIL = OWNER;
  delete process.env.DISCOVERY_LIST;
  delete process.env.DISCOVERY_LIST_EMAILS;
});

describe('Review stage: the Found gate', () => {
  it('shows no Found section, and runs no search, for a user without the flag', async () => {
    const out = await render('someone@example.com');
    expect(out).not.toContain('Found on public tabs');
    expect(loadFoundMock).not.toHaveBeenCalled();
  });

  it('shows none for the owner under the kill switch', async () => {
    process.env.DISCOVERY_LIST = 'off';
    expect(await render()).not.toContain('Found on public tabs');
    expect(loadFoundMock).not.toHaveBeenCalled();
  });

  it('loads for the session user only (never a typed or Google name), under a budget', async () => {
    await render();
    expect(loadFoundMock).toHaveBeenCalledWith('user-1', { signal: expect.any(AbortSignal) });
  });
});

describe('Review stage: name claims', () => {
  it('sends the user to the Unmatched imports when there are some', async () => {
    loadFoundMock.mockResolvedValue({ input: input(), rows: [] });
    const out = await review('someone@example.com', 3);
    expect(out).toContain('We could not find you on 3 imported tabs');
    expect(out).toContain('href="/dashboard?filter=unmatched"');
    expect(out).toContain('Review 3 imports');
  });

  it('says so when every import has the user on it', async () => {
    expect(await review('someone@example.com', 0)).toContain('Every import has your name on it');
  });
});

describe('Review stage: the Found list', () => {
  it('sits under the page h1 (no h1 of its own), as one list with no tiers', async () => {
    const out = await render();
    expect(out).not.toContain('<h1');
    expect(out).toContain('Found on public tabs');
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

describe('Review stage: Found empty states', () => {
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

describe('Review stage: when the Found search is slow or fails', () => {
  async function renderWith(email: string, impl: () => Promise<unknown>) {
    loadFoundMock.mockImplementation(impl);
    return review(email);
  }

  it('past the time budget: a "taking too long" state with a retry link, not a spinner', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const page = renderWith(OWNER, () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(12_001);
      const out = await page;
      expect(out).toContain('This is taking too long');
      expect(out).toContain('href="/dashboard?stage=review"');
      expect(out).toContain('Found on public tabs');
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
