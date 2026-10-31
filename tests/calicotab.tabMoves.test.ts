import { beforeEach, describe, expect, it, vi } from 'vitest';

// Moved tabs (owner, 2026-10-31): a URL to an old site and slug is read from
// the new one, keeping the rest of its path. The database is mocked.

const h = vi.hoisted(() => ({ db: { $queryRaw: vi.fn(), $executeRaw: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const { applyMoves, addTabMove, currentTabUrl, clearTabMovesCache, siteOf } =
  await import('@/lib/calicotab/tabMoves');

// "host/slug" to "host/slug"; a bare "host" is a root-hosted tab.
const move = (from: string, to: string) => {
  const [fromHost = '', fromSlug = ''] = from.split('/');
  const [toHost = '', toSlug = ''] = to.split('/');
  return { id: '1', fromHost, fromSlug, toHost, toSlug, addedBy: 'a@x', addedAt: new Date(0) };
};
const korea = move('wudckorea.herokuapp.com/2021', 'wudckorea.calicotab.com/2021');
const uadc = move('edudrift.calicotab.com/uadc2021', 'edudriftbackup.calicotab.com/uadc2021');

const sql = (call: unknown[]) => {
  const q = call[0] as { strings?: string[]; values?: unknown[] };
  return { text: (q.strings ?? []).join('?'), values: q.values ?? [] };
};

beforeEach(() => {
  vi.clearAllMocks();
  clearTabMovesCache();
  h.db.$queryRaw.mockResolvedValue([]);
  h.db.$executeRaw.mockResolvedValue(0);
});

describe('applyMoves', () => {
  it('moves a private URL to the new site over https, keeping its key', () => {
    expect(applyMoves('http://wudckorea.herokuapp.com/2021/privateurls/abc123/', [korea])).toBe(
      'https://wudckorea.calicotab.com/2021/privateurls/abc123/',
    );
    expect(applyMoves('https://EduDrift.calicotab.com/UADC2021/tab/team/', [uadc])).toBe(
      'https://edudriftbackup.calicotab.com/uadc2021/tab/team/',
    );
  });
  it('can change the slug, or move a root-hosted tab', () => {
    const renamed = move('a.calicotab.com/old', 'b.calicotab.com/new');
    expect(applyMoves('https://a.calicotab.com/old/privateurls/k/', [renamed])).toBe(
      'https://b.calicotab.com/new/privateurls/k/',
    );
    const root = move('x.herokuapp.com', 'x.calicotab.com/x2020');
    expect(applyMoves('https://x.herokuapp.com/privateurls/k/', [root])).toBe(
      'https://x.calicotab.com/x2020/privateurls/k/',
    );
  });
  it("leaves the old site's other tournaments, and every other URL, as they are", () => {
    const other = 'https://edudrift.calicotab.com/other2021/privateurls/k/';
    expect(applyMoves(other, [uadc])).toBe(other);
    expect(applyMoves('not a url', [uadc])).toBe('not a url');
  });
});

describe('currentTabUrl', () => {
  it('reads the moves once and keeps them for the next URL', async () => {
    h.db.$queryRaw.mockResolvedValue([{ ...korea, id: 1n }]);
    const old = 'http://wudckorea.herokuapp.com/2021/privateurls/k/';
    expect(await currentTabUrl(old)).toBe('https://wudckorea.calicotab.com/2021/privateurls/k/');
    expect(await currentTabUrl('https://real.calicotab.com/t/')).toBe(
      'https://real.calicotab.com/t/',
    );
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('has no moves on a database without the table', async () => {
    h.db.$queryRaw.mockRejectedValue(Object.assign(new Error('missing'), { code: '42P01' }));
    const url = 'https://wudckorea.herokuapp.com/2021/';
    expect(await currentTabUrl(url)).toBe(url);
  });
});

describe('addTabMove', () => {
  it('keeps only the sites, never a private key, and queues the old address again', async () => {
    h.db.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(3);
    const out = await addTabMove(
      'https://australs2020.herokuapp.com/australs2020/privateurls/s3cret/',
      'https://australs2020.calicotab.com/australs2020/',
      'a@x',
    );
    expect(out).toEqual({
      kind: 'added',
      move: {
        fromHost: 'australs2020.herokuapp.com',
        fromSlug: 'australs2020',
        toHost: 'australs2020.calicotab.com',
        toSlug: 'australs2020',
      },
      requeued: 3,
    });
    const insert = sql(h.db.$executeRaw.mock.calls[0]!);
    expect(insert.text).toContain('INSERT INTO "TabMove"');
    expect(JSON.stringify(insert.values)).not.toContain('s3cret');
    const requeue = sql(h.db.$executeRaw.mock.calls[1]!);
    expect(requeue.text).toContain(`"status" IN ('failed', 'abandoned')`);
    expect(requeue.values).toEqual([
      'https://australs2020.herokuapp.com/australs2020/%',
      'http://australs2020.herokuapp.com/australs2020/%',
    ]);
  });
  it('refuses a new address that is not an https tab site, or the same tab', async () => {
    const from = 'https://a.calicotab.com/t/';
    expect(await addTabMove(from, 'http://b.calicotab.com/t/', 'a@x')).toEqual({
      kind: 'invalid',
      reason: 'to',
    });
    expect(await addTabMove(from, 'https://evil.example.com/t/', 'a@x')).toEqual({
      kind: 'invalid',
      reason: 'to',
    });
    expect(await addTabMove(from, 'https://A.calicotab.com/T/tab/', 'a@x')).toEqual({
      kind: 'invalid',
      reason: 'same',
    });
    expect(await addTabMove('nonsense', 'https://b.calicotab.com/t/', 'a@x')).toEqual({
      kind: 'invalid',
      reason: 'from',
    });
    expect(h.db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('addTabMove: what it keeps', () => {
  it('escapes LIKE wildcards in a slug', async () => {
    h.db.$executeRaw.mockResolvedValue(0);
    await addTabMove('https://a.calicotab.com/my_tab/', 'https://b.calicotab.com/my_tab/', 'a@x');
    expect(sql(h.db.$executeRaw.mock.calls[1]!).values[0]).toBe(
      'https://a.calicotab.com/my\\_tab/%',
    );
  });
  it('reads a site from any URL on it', () => {
    expect(siteOf('https://X.herokuapp.com/privateurls/k/')).toEqual({
      host: 'x.herokuapp.com',
      slug: '',
    });
  });
});
