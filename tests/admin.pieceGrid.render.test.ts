import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PieceRow } from '@/lib/admin/scrapeHealth';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Server-render checks for the per-tournament piece grid (Task 9 of the
// partial-scrapes plan). There is no DOM environment, so the clicks are
// exercised through the pure selection helpers the component calls, and the
// request through `rescrapePieces` with `postJson` mocked.

const data = vi.hoisted(() => ({ current: null as unknown }));
const post = vi.hoisted(() => vi.fn());

vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => ({ id: 'admin' })) }));
vi.mock('@/lib/admin/scrapeHealth', () => ({
  getTournamentPieces: vi.fn(async () => data.current),
}));
vi.mock('@/lib/admin/tournamentAccuracy', () => ({
  getTournamentAccuracy: vi.fn(async () => null),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('@/lib/utils/api', () => ({ postJson: post }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/tournaments/5',
  useSearchParams: () => new URLSearchParams(),
}));

const NOW = Date.now();
const minutes = (n: number) => new Date(NOW + n * 60_000);

function piece(over: Partial<PieceRow> & Pick<PieceRow, 'kind' | 'key' | 'label'>): PieceRow {
  return {
    status: 'ok',
    httpStatus: 200,
    attempts: 0,
    loadedAt: minutes(-30),
    lastAttemptAt: minutes(-30),
    nextRetryAt: null,
    lastError: null,
    ...over,
  };
}

const failedSpeaker = piece({
  kind: 'speaker',
  key: '',
  label: 'Speaker tab',
  status: 'failed',
  httpStatus: 504,
  attempts: 2,
  loadedAt: null,
  lastAttemptAt: minutes(-5),
});

const fixture = {
  tournament: {
    id: BigInt(5),
    name: 'Oxford IV 2025',
    sourceUrl: 'https://oxiv.calicotab.com/oxiv2025/privateurls/abc123/',
  },
  tabs: [piece({ kind: 'team', key: '', label: 'Team tab' }), failedSpeaker],
  rounds: [
    piece({ kind: 'round', key: '1', label: 'R1' }),
    piece({
      kind: 'round',
      key: '2',
      label: 'R2',
      status: 'failed',
      httpStatus: null,
      attempts: 1,
      loadedAt: null,
    }),
    piece({ kind: 'round', key: 'grand-final', label: 'Grand Final' }),
  ],
};

async function renderPage(id = '5'): Promise<string> {
  const { default: Page } = await import('@/app/(app)/admin/tournaments/[id]/page');
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }));
}

describe('per-tournament piece grid', () => {
  beforeEach(() => {
    data.current = fixture;
    post.mockReset();
  });

  it('still shows the grid when the accuracy checks cannot be read', async () => {
    const mod = await import('@/lib/admin/tournamentAccuracy');
    vi.mocked(mod.getTournamentAccuracy).mockRejectedValueOnce(new Error('db down'));
    const out = await renderPage();
    expect(out).toContain('Re-scrape selected');
    expect(out).toContain('Not audited yet');
  });

  it('groups the pieces under Tabs and Rounds, with their status in words', async () => {
    const out = await renderPage();
    expect(out).toMatch(/<h1[^>]*>.*Oxford IV 2025.*<\/h1>/s);
    // The public tab, never the stored private URL.
    expect(out).toContain('href="https://oxiv.calicotab.com/oxiv2025/"');
    expect(out).not.toContain('abc123');
    expect(out).toMatch(/<legend[^>]*>.*?Tabs.*?<\/legend>/s);
    expect(out).toMatch(/<legend[^>]*>.*?Rounds.*?<\/legend>/s);
    expect(out).toContain('Failed · HTTP 504');
    expect(out).toContain('Loaded');
    expect(out).toMatch(/<input[^>]*type="checkbox"[^>]*aria-label="R2"/);
    expect(out).toContain('href="/admin"');
    // One polite live region for the outcome, there from the first paint,
    // and hidden while empty so it leaves no gap under the buttons (as the
    // overview's Retry failed does).
    expect(out).toMatch(/role="status"[^>]*><\/p>/);
    expect(out).toMatch(/<p[^>]*role="status"[^>]*class="[^"]*empty:hidden/);
    expect(out).toContain('Re-scrape selected (0)');
  });

  it('says a tournament with no pieces is tracked from the next scrape', async () => {
    data.current = { ...fixture, tabs: [], rounds: [] };
    const out = await renderPage();
    expect(out).toContain('No pieces recorded yet');
    expect(out).toContain('They are recorded from the next scrape.');
    expect(out).not.toContain('Re-scrape selected');
  });

  it('answers not found for an unknown or malformed id', async () => {
    data.current = null;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    data.current = fixture;
    await expect(renderPage('5abc')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

// Final review (2026-10-31): a page the tournament withholds is its own
// state, in words, and is not one of the failed pieces to select.
describe('a withheld piece', () => {
  const withheldMotions = piece({
    kind: 'motions',
    key: '',
    label: 'Motions',
    status: 'withheld',
    httpStatus: 403,
    loadedAt: null,
    lastAttemptAt: minutes(-5),
  });

  it('reads "Withheld by the tournament" and is not selected as failed', async () => {
    const { selectFailed, toPieceCard } = await import('@/lib/admin/pieceGrid');
    const card = toPieceCard(withheldMotions, new Date(NOW));
    expect(card).toMatchObject({ status: 'withheld', pill: 'Withheld by the tournament' });
    expect(selectFailed([card]).size).toBe(0);

    data.current = { ...fixture, tabs: [...fixture.tabs, withheldMotions] };
    const out = await renderPage();
    expect(out).toContain('Withheld by the tournament');
    // Still two failed tabs' worth of count: the withheld one is not failed.
    expect(out).toMatch(/3 pieces · 1 failed/);
  });
});

describe('Select failed, then Re-scrape selected', () => {
  beforeEach(() => post.mockReset());

  it('posts the failed pieces in grid order', async () => {
    const { selectFailed, piecesPayload, rescrapePieces, toPieceCard } =
      await import('@/lib/admin/pieceGrid');
    const now = new Date(NOW);
    const cards = [...fixture.tabs, ...fixture.rounds].map((p) => toPieceCard(p, now));
    const selected = selectFailed(cards);
    expect(selected.size).toBe(2);
    const body = piecesPayload(cards, selected);
    expect(body).toEqual({
      pieces: [
        { kind: 'speaker', key: '' },
        { kind: 'round', key: '2' },
      ],
    });
    post.mockResolvedValue({ ok: true, data: { loaded: [], failed: [], notOnTab: [] } });
    await rescrapePieces('5', body);
    expect(post).toHaveBeenCalledWith('/api/admin/tournaments/5/rescrape', {
      pieces: [
        { kind: 'speaker', key: '' },
        { kind: 'round', key: '2' },
      ],
    });
  });

  it('labels the button with the count and says what is happening while it runs', async () => {
    const { PieceGridView } = await import('@/components/admin/PieceGrid');
    const { selectFailed, toPieceCard } = await import('@/lib/admin/pieceGrid');
    const now = new Date(NOW);
    const tabs = fixture.tabs.map((p) => toPieceCard(p, now));
    const rounds = fixture.rounds.map((p) => toPieceCard(p, now));
    const selected = selectFailed([...tabs, ...rounds]);
    const props = {
      tabs,
      rounds,
      selected,
      error: null,
      result: null,
      onToggle: () => {},
      onSelectFailed: () => {},
      onClear: () => {},
      onSubmit: () => {},
    };
    const idle = renderToStaticMarkup(
      React.createElement(PieceGridView, { ...props, running: null }),
    );
    expect(idle).toContain('Re-scrape selected (2)');
    expect(idle).toMatch(/<input[^>]*aria-label="Speaker tab"[^>]*checked=""/);

    const busy = renderToStaticMarkup(React.createElement(PieceGridView, { ...props, running: 2 }));
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toMatch(
      /role="status"[^>]*>Re-scraping 2 pieces… This can take up to a minute\.<\/p>/,
    );
  });
});

describe('the picker in words (UX-16, UX-23)', () => {
  it('puts the outcome and every failure into words', async () => {
    const { resultLine, validateSelection } = await import('@/lib/admin/pieceGrid');
    expect(resultLine({ loaded: [{}, {}, {}], failed: [{}], notOnTab: [] })).toBe(
      'Loaded 3 · Failed 1 · Not on the tab any more 0',
    );
    expect(validateSelection(0)).toBe('Tick at least one piece to re-scrape.');
    expect(validateSelection(41)).toBe('Pick at most 40 pieces at a time. 41 are ticked.');
    expect(validateSelection(2)).toBeNull();
    const { rescrapeFailureMessage } = await import('@/lib/admin/actionMessage');
    for (const error of ['scrape_busy', 'not_found', 'bad_request', 'server_error']) {
      expect(rescrapeFailureMessage({ status: 400, error })).not.toMatch(/_/);
    }
    expect(rescrapeFailureMessage({ status: 0, error: 'Failed to fetch' })).not.toContain(
      'Failed to fetch',
    );
  });
});
