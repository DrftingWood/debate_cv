import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runAudit, captureException } = vi.hoisted(() => ({
  runAudit: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@/lib/audit/run', () => ({ runAudit }));
vi.mock('@sentry/nextjs', () => ({ captureException }));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { oldParserWhere, refreshOldParser } from '@/lib/admin/oldParserFill';
import { OLD_PARSER_BATCH_SIZE, oldParserSummary } from '@/lib/admin/oldParserText';
import { PARSER_VERSION } from '@/lib/calicotab/version';
import type { PartialResult, rescrapePieces } from '@/lib/calicotab/partialScrape';

// "Refresh old-parser tournaments": the partial re-scrape is injected; the
// pool, the pieces asked for, the re-stamping and the cursor are the real code.

const done = (failed: PartialResult['failed'] = []): PartialResult => ({
  tournamentId: 0n,
  loaded: [{ kind: 'team', key: '' }],
  failed,
  notOnTab: [],
});

beforeEach(() => {
  resetPrismaMock();
  runAudit.mockReset().mockResolvedValue(undefined);
  captureException.mockReset();
  prismaMock.tournament.count.mockResolvedValue(0);
  prismaMock.tournament.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.scrapePiece.findMany.mockResolvedValue([
    { kind: 'team', key: '' },
    { kind: 'round', key: '1' },
  ]);
});

describe('oldParserWhere', () => {
  it('takes stamped older tournaments with a readable page on record, not ignored ones', () => {
    expect(oldParserWhere(null)).toEqual({
      ignored: false,
      parserVersion: { lt: PARSER_VERSION },
      scrapePieces: { some: { status: { not: 'withheld' } } },
    });
    expect(oldParserWhere(5n)).toMatchObject({ id: { gt: 5n } });
  });
});

describe('refreshOldParser', () => {
  it('re-reads every recorded page and re-stamps what loaded fully', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
    const rescrape = vi
      .fn()
      .mockResolvedValueOnce(done())
      .mockResolvedValueOnce(done([{ kind: 'round', key: '1' }]));
    prismaMock.tournament.count.mockResolvedValue(3);
    const out = await refreshOldParser(null, { rescrape: rescrape as typeof rescrapePieces });
    expect(rescrape).toHaveBeenCalledWith(
      1n,
      [
        { kind: 'team', key: '' },
        { kind: 'round', key: '1' },
      ],
      expect.anything(),
    );
    expect(out).toEqual({ refreshed: 1, failed: 1, left: 3, next: '2' });
    // Only the fully read tournament is re-stamped, guarded against a newer stamp.
    expect(prismaMock.tournament.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.tournament.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, parserVersion: { lt: PARSER_VERSION } },
      data: { parserVersion: PARSER_VERSION },
    });
    expect(runAudit).toHaveBeenCalledWith([1n, 2n]);
  });
});

describe('refreshOldParser: bounds and failures', () => {
  it('takes at most 20, oldest first, and does nothing on an empty pool', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([]);
    const rescrape = vi.fn();
    expect(await refreshOldParser(null, { rescrape })).toEqual({
      refreshed: 0,
      failed: 0,
      left: 0,
      next: null,
    });
    expect(OLD_PARSER_BATCH_SIZE).toBe(20);
    expect(prismaMock.tournament.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, orderBy: { id: 'asc' } }),
    );
    expect(rescrape).not.toHaveBeenCalled();
  });

  it('counts a busy tournament as failed without reporting it, and reports the unexpected by code', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
    const busy = Object.assign(new Error('busy'), { name: 'ScrapeBusyError' });
    const rescrape = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(new Error('boom'));
    const out = await refreshOldParser(null, { rescrape: rescrape as typeof rescrapePieces });
    expect(out.failed).toBe(2);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(prismaMock.tournament.updateMany).not.toHaveBeenCalled();
  });

  it('stops starting tournaments when the deadline is near, and resumes after the last one tried', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
    const rescrape = vi.fn().mockResolvedValue(done());
    prismaMock.tournament.count.mockResolvedValue(1);
    const out = await refreshOldParser(null, { rescrape, deadline: Date.now() + 1_000 });
    expect(rescrape).not.toHaveBeenCalled();
    expect(out.next).toBe('0');
  });

  it('words the summary line', () => {
    expect(oldParserSummary({ refreshed: 12, failed: 1, left: 40, next: '9' })).toBe(
      'Refreshed 12 · failed 1 · 40 left',
    );
  });
});
