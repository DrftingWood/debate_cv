import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

// Task 5c: the review set's route. POST adds failed imports (or, from Task
// 5d, CV reports and parser warnings) with a priority and a comment; PATCH
// edits or closes one; GET exports the set for a later session to read.

vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { GET, POST, PATCH } = await import('@/app/api/admin/review-set/route');

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;
const URL_ = 'http://x/api/admin/review-set';

const send = (method: 'POST' | 'PATCH', body: unknown) =>
  (method === 'POST' ? POST : PATCH)(new Request(URL_, { method, body: JSON.stringify(body) }));
const get = (query: string) => GET(new Request(`${URL_}?${query}`));

const two = {
  items: [
    { source: 'import', sourceId: 'j1' },
    { source: 'import', sourceId: 'j2' },
  ],
  priority: 'high',
  comment: 'Round 3 is missing',
};

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  resetPrismaMock();
  prismaMock.ingestJob.findMany.mockResolvedValue([
    { id: 'j1', url: PRIVATE, userId: 'u1', attempts: 3, lastError: 'HTTP 503' },
    {
      id: 'j2',
      url: 'https://newt.calicotab.com/n26/',
      userId: 'u2',
      attempts: 1,
      lastError: null,
    },
  ]);
  prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
  prismaMock.tournament.findMany.mockResolvedValue([]);
  prismaMock.scrapePiece.findMany.mockResolvedValue([]);
  prismaMock.reviewFlag.findMany.mockResolvedValue([]);
  prismaMock.reviewFlag.createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
  prismaMock.reviewFlag.updateMany.mockImplementation(async ({ where }) => ({
    count: where.id.in.length,
  }));
});

describe('admin only', () => {
  it('answers 403 to a signed-in non-admin, on every method, and touches nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    for (const res of [await send('POST', two), await send('PATCH', { id: '1' }), await get('')]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    expect(prismaMock.reviewFlag.createMany).not.toHaveBeenCalled();
    expect(prismaMock.reviewFlag.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/review-set', () => {
  it('flags two jobs, by the signed-in admin', async () => {
    const res = await send('POST', two);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flagged: 2 });
    const data = prismaMock.reviewFlag.createMany.mock.calls[0][0].data;
    expect(data.map((f: { sourceId: string }) => f.sourceId)).toEqual(['j1', 'j2']);
    expect(data[0]).toMatchObject({ priority: 'high', createdBy: 'admin@example.com' });
    expect(JSON.stringify(data)).not.toContain(KEY);
  });

  it('a repeat refreshes the open flag instead of adding a second one', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([
      { id: 7n, source: 'import', sourceId: 'j1' },
    ]);
    const res = await send('POST', { ...two, priority: 'low', comment: 'still broken' });
    expect(await res.json()).toEqual({ flagged: 2 });
    expect(prismaMock.reviewFlag.findMany.mock.calls[0][0].where).toMatchObject({ status: 'open' });
    expect(prismaMock.reviewFlag.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7n] } },
      data: { priority: 'low', comment: 'still broken' },
    });
    const created = prismaMock.reviewFlag.createMany.mock.calls[0][0].data;
    expect(created.map((f: { sourceId: string }) => f.sourceId)).toEqual(['j2']);
  });

  it('rejects an empty comment, a bad priority, no items and too many with 400', async () => {
    const bodies = [
      { ...two, comment: '' },
      { ...two, comment: '   ' },
      { ...two, comment: 'x'.repeat(1001) },
      { ...two, priority: 'urgent' },
      { ...two, items: [] },
      { ...two, items: [{ source: 'email', sourceId: 'x' }] },
      {
        ...two,
        items: Array.from({ length: 201 }, (_, i) => ({ source: 'import', sourceId: `${i}` })),
      },
      null,
    ];
    for (const body of bodies) {
      const res = await send('POST', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    }
    expect(prismaMock.reviewFlag.createMany).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/review-set', () => {
  it('marks a flag done', async () => {
    prismaMock.reviewFlag.findUnique.mockResolvedValue({
      id: 7n,
      source: 'import',
      sourceId: 'j1',
      status: 'open',
    });
    prismaMock.reviewFlag.update.mockResolvedValue({});
    const res = await send('PATCH', { id: '7', status: 'done' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prismaMock.reviewFlag.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { status: 'done' },
    });
  });

  it('answers not_found for a flag that is gone, and 400 for nothing to change', async () => {
    prismaMock.reviewFlag.findUnique.mockResolvedValue(null);
    const gone = await send('PATCH', { id: '7', priority: 'high' });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: 'not_found' });
    expect((await send('PATCH', { id: '7' })).status).toBe(400);
    expect((await send('PATCH', { id: 'abc', status: 'done' })).status).toBe(400);
  });

  it('will not reopen a flag while another one for the same item is open', async () => {
    prismaMock.reviewFlag.findUnique.mockResolvedValue({
      id: 7n,
      source: 'import',
      sourceId: 'j1',
      status: 'done',
    });
    prismaMock.reviewFlag.findFirst.mockResolvedValue({ id: 9n });
    const res = await send('PATCH', { id: '7', status: 'open' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_open' });
    expect(prismaMock.reviewFlag.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/review-set', () => {
  const at = (s: string) => new Date(s);
  const row = (id: bigint, priority: string, createdAt: string) => ({
    comment: 'c',
    id,
    source: 'import',
    sourceId: 'j1',
    url: 'https://oxiv.calicotab.com/oxiv2025/',
    tournamentId: null,
    tournament: null,
    priority,
    status: 'open',
    createdBy: 'admin@example.com',
    createdAt: at(createdAt),
    updatedAt: at(createdAt),
  });

  beforeEach(() => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([
      row(1n, 'low', '2026-10-31T09:00:00Z'),
      row(2n, 'high', '2026-10-29T09:00:00Z'),
      { ...row(3n, 'medium', '2026-10-30T09:00:00Z'), comment: `see ${PRIVATE}` },
      row(4n, 'high', '2026-10-30T09:00:00Z'),
    ]);
  });

  it('exports a CSV with a header row, high to low and newest first, as a dated download', async () => {
    const res = await get('format=csv&status=open');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="review-set-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const text = await res.text();
    const lines = text.split('\n');
    expect(lines[0]!.startsWith('id,source,source_id,priority,')).toBe(true);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['4', '2', '3', '1']);
    expect(text.toLowerCase()).not.toContain('privateurls');
    expect(text).not.toContain(KEY);
    // The job's error in words and its attempts ride along.
    expect(text).toContain('The tab site had a problem on its side. Retry later.');
  });

  it('exports JSON by default, with the same order and no key', async () => {
    const res = await get('');
    expect(res.headers.get('content-disposition')).toMatch(/review-set-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await res.json();
    expect(body.flags.map((f: { id: string }) => f.id)).toEqual(['4', '2', '3', '1']);
    expect(body.flags[0]).toMatchObject({
      source: 'import',
      sourceId: 'j1',
      url: 'https://oxiv.calicotab.com/oxiv2025/',
      attempts: 3,
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain('privateurls');
  });

  it('reads done flags too with status=all, and rejects an unknown format', async () => {
    await get('status=all');
    expect(prismaMock.reviewFlag.findMany.mock.calls[0][0].where).toEqual({});
    expect((await get('format=xml')).status).toBe(400);
  });
});
