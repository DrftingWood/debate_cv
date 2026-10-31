import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R10: the `home` piece of a partial re-scrape. It is the landing page the
 * re-scrape has already fetched, so it needs no request of its own, takes no
 * scrape claim and is read after the tabs. ingest and the staff store are
 * mocked; the splitting of pieces, the order and the recorded outcome are the
 * real code.
 */

const BASE = 'https://cnlupd2023.calicotab.com/13thcnlupreuadc2022/';
const h = vi.hoisted(() => ({
  order: [] as string[],
  runFullScrape: vi.fn(),
  acquire: vi.fn(),
  recordStaff: vi.fn(),
  recordOutcomes: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@sentry/nextjs', () => ({ captureException: h.captureException }));
vi.mock('@/lib/calicotab/staffStore', () => ({ recordStaffFromHome: h.recordStaff }));
vi.mock('@/lib/calicotab/scrapePieces', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/calicotab/scrapePieces')>()),
  recordPieceOutcomes: h.recordOutcomes,
  recordPiecesNotReached: vi.fn(),
}));
vi.mock('@/lib/calicotab/ingest', () => ({
  acquireScrapeClaim: h.acquire,
  releaseScrapeClaim: vi.fn(),
  FetchCutOffError: class extends Error {},
  NothingLoadedError: class extends Error {},
  ScrapeBusyError: class extends Error {},
  recordEveryJudgeFromRoundResults: vi.fn(),
  runFullScrape: h.runFullScrape,
  loadPublicLanding: async () => ({
    base: BASE,
    fingerprint: 'fp',
    loaded: {
      existing: { id: 7n },
      landingHtml: '<html>staff</html>',
      snapshot: {
        navigation: {
          participants: `${BASE}participants/list/`,
          teamTab: null,
          speakerTab: null,
          motionsTab: null,
          resultsRounds: [],
          breakTabs: [],
        },
      },
    },
  }),
}));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { rescrapePieces, TournamentNotFoundError } from '@/lib/calicotab/partialScrape';

beforeEach(() => {
  resetPrismaMock();
  h.order.length = 0;
  h.runFullScrape.mockReset().mockImplementation(async () => {
    h.order.push('tabs');
  });
  h.acquire.mockReset().mockResolvedValue('acquired');
  h.recordStaff.mockReset().mockImplementation(async () => {
    h.order.push('home');
    return { found: true, named: 2, linked: 1 };
  });
  h.recordOutcomes.mockReset().mockResolvedValue(undefined);
  h.captureException.mockReset();
  prismaMock.tournament.findUnique.mockResolvedValue({
    id: 7n,
    sourceUrlRaw: BASE,
  });
});

describe('rescrapePieces: the home piece', () => {
  it('reads the staff block off the landing page already in hand, with no claim and no tab scrape', async () => {
    const r = await rescrapePieces(7n, [{ kind: 'home', key: '' }]);
    expect(r.loaded).toEqual([{ kind: 'home', key: '' }]);
    expect(r.failed).toEqual([]);
    expect(h.recordStaff).toHaveBeenCalledWith(7n, '<html>staff</html>');
    expect(h.acquire).not.toHaveBeenCalled();
    expect(h.runFullScrape).not.toHaveBeenCalled();
  });

  it('records the piece against the public tab address, never a private URL', async () => {
    await rescrapePieces(7n, [{ kind: 'home', key: '' }]);
    const [, outcomes] = h.recordOutcomes.mock.calls[0]!;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'home', key: '', ok: true, url: BASE });
    expect(JSON.stringify(outcomes)).not.toContain('privateurls');
  });

  it('reads home after the participants list, so its names link against the fresh list', async () => {
    const r = await rescrapePieces(7n, [
      { kind: 'home', key: '' },
      { kind: 'participants', key: '' },
    ]);
    expect(h.order).toEqual(['tabs', 'home']);
    expect(h.runFullScrape.mock.calls[0]![2]).toEqual({
      only: [{ kind: 'participants', key: '' }],
    });
    expect(r.notOnTab).toEqual([]);
    expect(r.loaded).toContainEqual({ kind: 'home', key: '' });
  });

  it('a failed store is a failed piece with an error code to Sentry, not a thrown error', async () => {
    h.recordStaff.mockRejectedValue(new Error('db down'));
    const r = await rescrapePieces(7n, [{ kind: 'home', key: '' }]);
    expect(r.failed).toEqual([{ kind: 'home', key: '' }]);
    expect(r.loaded).toEqual([]);
    expect(h.recordOutcomes.mock.calls[0]![1][0]).toMatchObject({ kind: 'home', ok: false });
    expect(h.captureException).toHaveBeenCalledTimes(1);
  });

  it('home is never "not on the tab": the landing page is always there', async () => {
    const r = await rescrapePieces(7n, [{ kind: 'home', key: '' }]);
    expect(r.notOnTab).toEqual([]);
    expect(prismaMock.scrapePiece.deleteMany).not.toHaveBeenCalled();
  });

  it('a tournament stored with only a private URL is refused, and its home page is never read', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 7n,
      sourceUrlRaw: `${BASE}privateurls/abc123/`,
    });
    await expect(rescrapePieces(7n, [{ kind: 'home', key: '' }])).rejects.toBeInstanceOf(
      TournamentNotFoundError,
    );
    expect(h.recordStaff).not.toHaveBeenCalled();
  });
});
