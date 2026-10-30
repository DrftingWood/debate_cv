import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * rescrapePieces (lib/calicotab/partialScrape.ts) when it fails before any
 * page is written: the landing page fails, the tournament has no public
 * address, or the deadline cuts the fetch short. Final review of partial
 * scrapes (2026-10-31): each of these must still count as an attempt for the
 * requested pieces, or their back-off never advances and the same
 * tournaments head the retry queue (ordered by nextRetryAt) on every tick.
 *
 * The scrape itself is mocked at the ingest boundary; what a cut-off fetch
 * hands back is pinned in calicotab.ingest.characterization.test.ts. The
 * ScrapePiece writes are the real code against the prisma mock.
 */

const BASE = 'https://oxiv.calicotab.com/oxiv2025/';
const R2 = `${BASE}results/round/2/`;
const R3 = `${BASE}results/round/3/`;
const BREAK_TAB = `${BASE}break/teams/open/`;

const h = vi.hoisted(() => ({
  loadPublicLanding: vi.fn(),
  runFullScrape: vi.fn(),
  recordPieceOutcomes: vi.fn(),
}));

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@/lib/calicotab/prescrape', () => ({
  publicTournamentBase: (url: string) => {
    if (!url.startsWith('https://')) throw new Error(`not a tournament URL: ${url}`);
    return { base: url };
  },
}));
vi.mock('@/lib/calicotab/scrapePieces', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/calicotab/scrapePieces')>()),
  recordPieceOutcomes: h.recordPieceOutcomes,
}));
vi.mock('@/lib/calicotab/ingest', async () => {
  const { IngestDeadlineError } = await import('@/lib/calicotab/fetchSession');
  class FetchCutOffError extends IngestDeadlineError {
    constructor(
      message: string,
      readonly outcomes: unknown[],
    ) {
      super(message);
    }
  }
  return {
    acquireScrapeClaim: vi.fn(async () => 'acquired'),
    releaseScrapeClaim: vi.fn(async () => undefined),
    recordEveryJudgeFromRoundResults: vi.fn(async () => undefined),
    loadPublicLanding: h.loadPublicLanding,
    runFullScrape: h.runFullScrape,
    FetchCutOffError,
    NothingLoadedError: class extends Error {},
    ScrapeBusyError: class extends Error {},
  };
});

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { FetchCutOffError } from '@/lib/calicotab/ingest';
import { rescrapePieces } from '@/lib/calicotab/partialScrape';

const NAV = {
  teamTab: null,
  speakerTab: null,
  motionsTab: null,
  participants: null,
  resultsRounds: [R2, R3],
  breakTabs: [BREAK_TAB],
};
const landing = (existingId = 7n) => ({
  base: BASE,
  loaded: { existing: { id: existingId }, snapshot: { navigation: NAV } },
});

const callsOf = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.map((c) => c[0] as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
const attemptUpdates = () =>
  callsOf(prismaMock.scrapePiece.update).filter((c) => 'attempts' in c.data);
const retryUpdates = () =>
  callsOf(prismaMock.scrapePiece.update).filter((c) => 'nextRetryAt' in c.data);

/** The failed ScrapePiece rows the database holds, and the attempt count each update returns. */
function install(opts: { sourceUrl?: string; attempts?: number } = {}) {
  prismaMock.tournament.findUnique.mockResolvedValue({
    id: 7n,
    sourceUrlRaw: opts.sourceUrl ?? BASE,
  });
  prismaMock.scrapePiece.findMany.mockImplementation(
    async (args: { where: { OR?: { kind: string; key: string }[] } }) =>
      (args.where.OR ?? []).map((r, i) => ({ id: BigInt(20 + i), ...r })),
  );
  prismaMock.scrapePiece.update.mockImplementation(async (args: { where: { id: bigint } }) => ({
    id: args.where.id,
    attempts: opts.attempts ?? 1,
  }));
  h.loadPublicLanding.mockResolvedValue(landing());
  h.recordPieceOutcomes.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetPrismaMock();
  h.loadPublicLanding.mockReset();
  h.runFullScrape.mockReset();
  h.recordPieceOutcomes.mockReset();
});

describe('rescrapePieces: failures before the landing page answers', () => {
  it('a landing page that fails advances the back-off of the requested pieces', async () => {
    install({ attempts: 2 });
    const before = Date.now();
    h.loadPublicLanding.mockRejectedValue(
      Object.assign(new Error(`fetch public home ${BASE} → HTTP 503`), { httpStatus: 503 }),
    );

    await expect(rescrapePieces(7n, [{ kind: 'round', key: '3' }])).rejects.toThrow(/HTTP 503/);

    // Only rows already failing: an ok piece is no worse for an attempt
    // that never reached its page.
    expect(callsOf(prismaMock.scrapePiece.findMany)[0]!.where).toEqual({
      tournamentId: 7n,
      status: 'failed',
      OR: [{ kind: 'round', key: '3' }],
    });
    expect(attemptUpdates()).toEqual([
      {
        where: { id: 20n },
        data: expect.objectContaining({
          attempts: { increment: 1 },
          httpStatus: 503,
          lastError: expect.stringContaining('HTTP 503'),
        }),
      },
    ]);
    // The second failure: the next try is an hour on, not this tick.
    const next = retryUpdates()[0]!.data.nextRetryAt as Date;
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(h.runFullScrape).not.toHaveBeenCalled();
  });

  it('a landing page that leads to another tournament counts an attempt too', async () => {
    install();
    h.loadPublicLanding.mockResolvedValue(landing(8n));

    await expect(rescrapePieces(7n, [{ kind: 'round', key: '3' }])).rejects.toThrow(
      /no longer matches/,
    );
    expect(attemptUpdates()).toHaveLength(1);
    expect(retryUpdates()[0]!.data.nextRetryAt).toBeInstanceOf(Date);
  });

  it('a tournament with no public address stops retrying at once', async () => {
    install({ sourceUrl: 'not a url' });

    await expect(rescrapePieces(7n, [{ kind: 'round', key: '3' }])).rejects.toThrow(
      /no public address/,
    );
    expect(retryUpdates()).toEqual([{ where: { id: 20n }, data: { nextRetryAt: null } }]);
    expect(h.loadPublicLanding).not.toHaveBeenCalled();
  });
});

describe('rescrapePieces: a deadline mid-fetch', () => {
  const pieces = [
    { kind: 'round' as const, key: '2' },
    { kind: 'round' as const, key: '3' },
    { kind: 'break' as const, key: 'open' },
  ];
  const r2Failed = {
    kind: 'round' as const,
    key: '2',
    label: 'R2',
    url: R2,
    ok: false,
    httpStatus: 504,
    error: 'HTTP 504',
  };
  const r3Read = { ...r2Failed, key: '3', label: 'R3', url: R3, ok: true, httpStatus: 200 };

  it('records what answered, fails the rest, and answers with a result', async () => {
    install();
    h.runFullScrape.mockRejectedValue(
      new FetchCutOffError('ingest stopped: deadline reached', [r2Failed, r3Read]),
    );

    const result = await rescrapePieces(7n, pieces);

    // A result, not an error: the admin sees failed pieces, not a 500.
    expect(result).toEqual({ tournamentId: 7n, loaded: [], failed: pieces, notOnTab: [] });
    // R2 answered 504: recorded as the failure it was.
    expect(h.recordPieceOutcomes).toHaveBeenCalledWith(7n, [r2Failed]);
    // R3 was read but never written, and the break never answered: an
    // attempt each, no verdict on their pages.
    expect(callsOf(prismaMock.scrapePiece.findMany)[0]!.where.OR).toEqual([
      { kind: 'round', key: '3' },
      { kind: 'break', key: 'open' },
    ]);
    expect(attemptUpdates().map((c) => c.where.id)).toEqual([20n, 21n]);
    expect(attemptUpdates()[0]!.data.lastError).toMatch(/deadline/);
  });
});
