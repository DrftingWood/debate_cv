import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TournamentList } from '@/lib/admin/tournamentList';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Server-render checks for /admin/tournaments (Task 5b): the pager, the two
// empty states, a URL search, and that a pasted private URL is never echoed.

const h = vi.hoisted(() => ({
  list: vi.fn(),
  lookup: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  }),
}));
vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => 'admin@example.com') }));
vi.mock('@/lib/admin/tournamentList', () => ({
  listTournaments: h.list,
  TOURNAMENTS_PER_PAGE: 20,
}));
vi.mock('@/lib/admin/tournamentLookup', () => ({ lookupTournament: h.lookup }));
vi.mock('next/navigation', () => ({
  // Throws as Next's does, so the page stops where it redirects.
  redirect: h.redirect,
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/tournaments',
  useSearchParams: () => new URLSearchParams(),
}));

const KEY = 'k3yS3cr3t';
const NOW = Date.now();

const row = (i: number): TournamentList['rows'][number] => ({
  id: String(i),
  name: `Tournament ${i}`,
  tabUrl: `https://t${i}.calicotab.com/t${i}/`,
  year: 2025,
  format: 'BP',
  scrapedAt: new Date(NOW - 3_600_000),
  parserCurrent: i !== 21,
  score: i === 21 ? null : 92,
  band: i === 21 ? null : 'good',
  partlyLoaded: i === 22,
  onCvs: 3,
});

async function render(searchParams: Record<string, string>): Promise<string> {
  const { default: Page } = await import('@/app/(app)/admin/tournaments/page');
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  h.list.mockReset();
  h.lookup.mockReset();
  h.redirect.mockClear();
});

describe('/admin/tournaments', () => {
  it('pages the ledger, 20 a page, and Previous/Next keep the search', async () => {
    h.list.mockResolvedValue({
      rows: Array.from({ length: 20 }, (_, i) => row(21 + i)),
      total: 45,
      page: 2,
      pages: 3,
    });
    const out = await render({ q: 'tournament', page: '2' });

    expect(h.list).toHaveBeenCalledWith({ page: 2, q: 'tournament' });
    expect(out.match(/<h1[^>]*>Tournaments in the database<\/h1>/g)).toHaveLength(1);
    expect(out).toContain('21–40 of 45 · page 2 of 3');
    expect(out).toMatch(/<nav aria-label="Tournament pages"/);
    expect(out).toContain('href="/admin/tournaments?q=tournament"');
    expect(out).toContain('href="/admin/tournaments?q=tournament&amp;page=3"');
    expect(out).toContain('href="/admin/tournaments/21"');
    expect(out).toContain('Old parser');
    expect(out).toContain('Partly loaded');
    // The search box keeps the name that was searched.
    expect(out).toMatch(/<input[^>]*name="q"[^>]*value="tournament"/);
  });

  it('keeps "nothing stored" and "nothing matches" apart (UX-24)', async () => {
    h.list.mockResolvedValue({ rows: [], total: 0, page: 1, pages: 1 });
    const none = await render({});
    const miss = await render({ q: 'zzz' });
    expect(none).toContain('No tournaments stored yet');
    expect(none).not.toContain('Nothing matches');
    expect(miss).toContain('Nothing matches &#x27;zzz&#x27;');
    expect(miss).not.toContain('No tournaments stored yet');
    expect(none).not.toContain('Tournament pages');
  });
});

describe('/admin/tournaments with a pasted URL', () => {
  // Review of a00d4c0: the flight data carries the search params, so a
  // private ?q= is redirected to its public form before anything renders.
  it('redirects a private URL in ?q= to its public form, scheme or not', async () => {
    const PUBLIC_Q = `/admin/tournaments?q=${encodeURIComponent('https://oxiv.calicotab.com/oxiv2025/')}`;
    for (const q of [
      `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`,
      `oxiv.calicotab.com/oxiv2025/PrivateURLs/${KEY}/`,
    ]) {
      h.redirect.mockClear();
      await expect(render({ q })).rejects.toMatchObject({ to: PUBLIC_Q });
      expect(h.redirect).toHaveBeenCalledWith(PUBLIC_Q);
    }
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.list).not.toHaveBeenCalled();
  });

  it('resolves a public URL in ?q= and answers in words', async () => {
    h.lookup.mockResolvedValue({
      kind: 'not_stored',
      host: 'oxiv.calicotab.com',
      slug: 'oxiv2025',
      publicUrl: 'https://oxiv.calicotab.com/oxiv2025/',
    });
    const out = await render({ q: 'https://oxiv.calicotab.com/oxiv2025/' });

    expect(h.lookup).toHaveBeenCalledTimes(1);
    expect(h.list).not.toHaveBeenCalled();
    expect(out).toContain('Not in the database');
    expect(out).toContain('href="https://oxiv.calicotab.com/oxiv2025/"');
    expect(out).toMatch(
      /<input[^>]*name="q"[^>]*value="https:\/\/oxiv\.calicotab\.com\/oxiv2025\/"/,
    );
    // Without JavaScript the box posts, so its text stays out of the address.
    expect(out).toMatch(/<form[^>]*action="\/api\/admin\/lookup\/search"[^>]*method="post"/);
  });

  it('shows a stored URL with its page link, score and band', async () => {
    h.lookup.mockResolvedValue({
      kind: 'stored',
      id: '7',
      name: 'Oxford IV 2025',
      publicUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      scrapedAt: new Date(NOW - 2 * 3_600_000),
      parserCurrent: true,
      score: 74,
      band: 'check',
      partlyLoaded: true,
    });
    const out = await render({ q: 'https://oxiv.calicotab.com/oxiv2025/' });
    expect(out).toContain('Oxford IV 2025');
    expect(out).toContain('href="/admin/tournaments/7"');
    expect(out).toContain('Stored 2 h ago');
    expect(out).toMatch(/Check.*74/);
    expect(out).toContain('Partly loaded');
  });

  it('says so when a URL is not a tab URL', async () => {
    h.lookup.mockResolvedValue({ kind: 'invalid' });
    const out = await render({ q: 'https://example.com/x/' });
    expect(out).toContain('That isn&#x27;t a tab URL');
  });
});
