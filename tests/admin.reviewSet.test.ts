import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// Task 5c: the Tab status of a failed import (owner, 2026-10-31: "tick if
// fully loaded in tab, ? if partially load (hover to see the errors) and X if
// not loaded") and the review set's read model, from mocked stored data.

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { tabState, pieceErrorText, loadTabStates, MAX_TAB_ERRORS } =
  await import('@/lib/admin/tabStatus');
const { addToReviewSet, loadReviewSet, reviewSetCsv, scrubComment, sortFlags, updateFlag } =
  await import('@/lib/admin/reviewSet');

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;
const d = (s: string) => new Date(s);

beforeEach(() => {
  resetPrismaMock();
  prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
  prismaMock.tournament.findMany.mockResolvedValue([]);
  prismaMock.scrapePiece.findMany.mockResolvedValue([]);
  prismaMock.ingestJob.findMany.mockResolvedValue([]);
});

describe('tab status of a failed import', () => {
  it('is missing when the tournament is not stored', () => {
    expect(tabState(null, [])).toEqual({ state: 'missing', tournamentId: null, errors: [] });
  });

  it('is loaded when the stored tournament has no failed page', () => {
    expect(tabState('5', [])).toEqual({ state: 'loaded', tournamentId: '5', errors: [] });
  });

  it('is partial with one line per failed page, in words, never the raw error', () => {
    const t = tabState('5', [
      { label: 'R3', httpStatus: 503, lastError: `HTTP 503 at ${PRIVATE}results/round/3/` },
      { label: 'Speaker tab', httpStatus: null, lastError: 'AbortError: timed out after 15000ms' },
      { label: 'Team tab', httpStatus: null, lastError: 'TypeError: cannot read x of undefined' },
      { label: 'Motions', httpStatus: null, lastError: null },
    ]);
    expect(t.state).toBe('partial');
    expect(t.tournamentId).toBe('5');
    expect(t.errors).toEqual([
      'R3: HTTP 503 Service Unavailable',
      'Speaker tab: timed out',
      'Team tab: page could not be read',
      'Motions: did not load',
    ]);
    expect(JSON.stringify(t)).not.toContain(KEY);
    expect(JSON.stringify(t)).not.toContain('TypeError');
  });

  it('keeps at most ten lines, the last one counting the rest', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      label: `R${i + 1}`,
      httpStatus: 500,
      lastError: null,
    }));
    const t = tabState('5', many);
    expect(t.errors).toHaveLength(MAX_TAB_ERRORS);
    expect(t.errors[8]).toBe('R9: HTTP 500 Internal Server Error');
    expect(t.errors[9]).toBe('and 5 more pages');
  });

  it('words an unusual status by its number alone', () => {
    expect(pieceErrorText({ label: 'R1', httpStatus: 418, lastError: null })).toBe('R1: HTTP 418');
  });

  it('loads every stored tournament in one query', async () => {
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      { tournamentId: 5n, label: 'R3', httpStatus: 502, lastError: null },
    ]);
    const map = await loadTabStates(['5', '6', '5']);
    expect(prismaMock.scrapePiece.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.scrapePiece.findMany.mock.calls[0][0].where).toEqual({
      status: 'failed',
      tournamentId: { in: [5n, 6n] },
    });
    expect(map.get('5')).toMatchObject({ state: 'partial', errors: ['R3: HTTP 502 Bad Gateway'] });
    expect(map.get('6')).toEqual({ state: 'loaded', tournamentId: '6', errors: [] });
  });

  it('asks nothing when no tournament is stored', async () => {
    expect((await loadTabStates([])).size).toBe(0);
    expect(prismaMock.scrapePiece.findMany).not.toHaveBeenCalled();
  });
});

describe('comments never carry a private key', () => {
  it('turns a pasted private URL into its public form, and drops a bare key path', () => {
    expect(scrubComment(`check ${PRIVATE}results/round/3/ please`)).toBe(
      'check https://oxiv.calicotab.com/oxiv2025/ please',
    );
    expect(scrubComment(`see oxiv.calicotab.com/x/privateurls/${KEY}/`)).toBe(
      'see [private link removed]',
    );
    expect(scrubComment('  plain words  ')).toBe('plain words');
  });
});

describe('adding to the review set', () => {
  it('skips an id that is no longer a job, and stores only the public address', async () => {
    prismaMock.ingestJob.findMany.mockResolvedValue([{ id: 'j1', url: PRIVATE, userId: 'u1' }]);
    prismaMock.reviewFlag.findMany.mockResolvedValue([]);
    prismaMock.reviewFlag.createMany.mockResolvedValue({ count: 1 });
    const out = await addToReviewSet({
      items: [
        { source: 'import', sourceId: 'j1' },
        { source: 'import', sourceId: 'gone' },
        { source: 'import', sourceId: 'j1' },
      ],
      priority: 'high',
      comment: 'R3 missing',
      createdBy: 'admin@example.com',
    });
    expect(out).toEqual({ flagged: 1 });
    const data = prismaMock.reviewFlag.createMany.mock.calls[0][0].data;
    expect(data).toEqual([
      expect.objectContaining({
        source: 'import',
        sourceId: 'j1',
        url: 'https://oxiv.calicotab.com/oxiv2025/',
        tournamentId: null,
        priority: 'high',
        comment: 'R3 missing',
        createdBy: 'admin@example.com',
      }),
    ]);
    expect(JSON.stringify(data)).not.toContain(KEY);
  });

  it('keeps a CV report or parser warning flag generic until Task 5d enriches it', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([]);
    prismaMock.reviewFlag.createMany.mockResolvedValue({ count: 1 });
    await addToReviewSet({
      items: [{ source: 'parser_warning', sourceId: 'parseTabs|Speaker tab has no totals' }],
      priority: 'low',
      comment: 'x',
      createdBy: 'a@b.c',
    });
    expect(prismaMock.reviewFlag.createMany.mock.calls[0][0].data[0]).toMatchObject({
      source: 'parser_warning',
      url: '',
      tournamentId: null,
    });
  });
});

const flag = (over: Record<string, unknown>) => ({
  id: 1n,
  source: 'import',
  sourceId: 'j1',
  url: 'https://oxiv.calicotab.com/oxiv2025/',
  tournamentId: null,
  tournament: null,
  priority: 'medium',
  comment: 'c',
  status: 'open',
  createdBy: 'admin@example.com',
  createdAt: d('2026-10-30T10:00:00Z'),
  updatedAt: d('2026-10-30T10:00:00Z'),
  ...over,
});

describe('reading the review set', () => {
  it('sorts high to low, then oldest or newest first', () => {
    const rows = [
      { id: 'a', priority: 'low', createdAt: d('2026-10-30') },
      { id: 'b', priority: 'high', createdAt: d('2026-10-28') },
      { id: 'c', priority: 'medium', createdAt: d('2026-10-29') },
      { id: 'd', priority: 'high', createdAt: d('2026-10-31') },
    ] as const;
    expect(sortFlags(rows, 'oldest').map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(sortFlags(rows, 'newest').map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it("gives each import flag its job's error in words, its attempts and a live tab status", async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([
      flag({ id: 2n, tournamentId: 5n, tournament: { id: 5n, name: 'Oxford IV' } }),
    ]);
    prismaMock.ingestJob.findMany.mockResolvedValue([
      { id: 'j1', url: PRIVATE, userId: 'u1', attempts: 3, lastError: 'HTTP 503 at fetch.ts:88' },
    ]);
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      { tournamentId: 5n, label: 'R3', httpStatus: 503, lastError: null },
    ]);
    const [f] = await loadReviewSet();
    expect(f).toMatchObject({
      id: '2',
      lastError: 'The tab site had a problem on its side. Retry later.',
      attempts: 3,
      tournament: { id: '5', name: 'Oxford IV' },
      tab: { state: 'partial', errors: ['R3: HTTP 503 Service Unavailable'] },
    });
    expect(prismaMock.reviewFlag.findMany.mock.calls[0][0].where).toEqual({ status: 'open' });
  });

  // Task 5d appended a detail column (what a CV report or parser warning is about).
  it('writes a CSV that survives commas, quotes and new lines in a comment', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([flag({ comment: 'say "hi", then\nmore' })]);
    const csv = reviewSetCsv(await loadReviewSet());
    const [header, ...rest] = csv.split('\n');
    expect(header).toBe(
      'id,source,source_id,priority,status,comment,url,tournament_id,tournament_name,last_error,attempts,tab,tab_errors,created_by,created_at,detail',
    );
    expect(rest.join('\n')).toContain('"say ""hi"", then\nmore"');
  });

  // Review leftover: a cap on the newest rows of every status let an old open
  // flag fall off once a thousand newer ones were done.
  it("reads every open flag, and only the newest done ones, for 'all'", async () => {
    prismaMock.reviewFlag.findMany
      .mockResolvedValueOnce([flag({ id: 1n, createdAt: d('2020-01-01') })])
      .mockResolvedValueOnce([flag({ id: 2n, status: 'done' })]);
    const flags = await loadReviewSet({ status: 'all' });
    expect(flags.map((f) => [f.id, f.status])).toEqual([
      ['2', 'done'],
      ['1', 'open'],
    ]);
    const [openQ, doneQ] = prismaMock.reviewFlag.findMany.mock.calls.map((c) => c[0]);
    expect(openQ.where).toEqual({ status: 'open' });
    expect(openQ.take).toBeUndefined();
    expect(doneQ.where).toEqual({ status: { not: 'open' } });
    expect(doneQ.take).toBe(1000);
  });
});

describe('one open flag per item, under a lock', () => {
  const lockSql = () =>
    (prismaMock.$executeRaw.mock.calls[0]?.[0] as readonly string[] | undefined)?.join('?');

  it('takes the review-set lock before reading the open flags it adds to', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([]);
    prismaMock.reviewFlag.createMany.mockResolvedValue({ count: 1 });
    await addToReviewSet({
      items: [{ source: 'parser_warning', sourceId: 'p|w' }],
      priority: 'low',
      comment: '',
      createdBy: 'a@b.c',
    });
    expect(lockSql()).toBe("SELECT pg_advisory_xact_lock(hashtext('review_set'))");
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.reviewFlag.findMany.mock.invocationCallOrder[0]!,
    );
  });

  it('reopens a done flag inside the same lock, and refuses while another is open', async () => {
    prismaMock.reviewFlag.findUnique.mockResolvedValue({
      id: 3n,
      source: 'import',
      sourceId: 'j1',
      status: 'done',
    });
    prismaMock.reviewFlag.findFirst.mockResolvedValueOnce({ id: 4n });
    expect(await updateFlag({ id: 3n, status: 'open' })).toBe('already_open');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(lockSql()).toBe("SELECT pg_advisory_xact_lock(hashtext('review_set'))");
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.reviewFlag.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(prismaMock.reviewFlag.update).not.toHaveBeenCalled();

    prismaMock.reviewFlag.findFirst.mockResolvedValueOnce(null);
    expect(await updateFlag({ id: 3n, status: 'open' })).toBe('ok');
    expect(prismaMock.reviewFlag.update).toHaveBeenCalledWith({
      where: { id: 3n },
      data: { status: 'open' },
    });
  });
});
