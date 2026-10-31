import { beforeEach, describe, expect, it, vi } from 'vitest';

// Deleting a tournament and keeping it deleted (owner, 2026-10-31). The
// database is mocked; each test checks what is asked of it.

const h = vi.hoisted(() => ({
  db: {
    tournament: { findUnique: vi.fn(), delete: vi.fn() },
    discoveredUrl: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const {
  siteKey,
  siteText,
  publicTabUrl,
  isDeletedSite,
  refuseDeletedSite,
  deleteTournament,
  listDeleted,
  allowAgain,
  DELETED_MARKER,
} = await import('@/lib/admin/deletedTournaments');
const { isPermanentError } = await import('@/lib/queue');

const sql = (call: unknown[]) => {
  const q = call[0] as { strings?: string[]; values?: unknown[] };
  return { text: (q.strings ?? []).join('?'), values: q.values ?? [] };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$queryRaw.mockResolvedValue([]);
  h.db.$executeRaw.mockImplementation(async (q: unknown) => q);
  h.db.$transaction.mockImplementation(async (ops: unknown[]) => ops);
  h.db.discoveredUrl.groupBy.mockResolvedValue([]);
});

describe('siteKey', () => {
  it('keeps the host and the first path segment, lowercased, and never the private key', () => {
    expect(siteKey('https://Demo.Calicotab.com/MyTest/privateurls/abc123/')).toEqual({
      host: 'demo.calicotab.com',
      slug: 'mytest',
    });
    expect(siteKey('https://demo.calicotab.com/mytest/')).toEqual({
      host: 'demo.calicotab.com',
      slug: 'mytest',
    });
  });
  it("gives a root-hosted tab's private URL an empty slug", () => {
    const k = siteKey('https://x.herokuapp.com/privateurls/abc123/')!;
    expect(k).toEqual({ host: 'x.herokuapp.com', slug: '' });
    expect(siteText(k)).toBe('x.herokuapp.com/');
    expect(publicTabUrl(k)).toBe('https://x.herokuapp.com/');
  });
  it('answers null for text that is not a URL', () => {
    expect(siteKey('not a url')).toBeNull();
  });
});

describe('the ingest refusal', () => {
  it('looks the site address up and throws a marked error when it was deleted', async () => {
    h.db.$queryRaw.mockResolvedValue([{ hit: 1 }]);
    await expect(
      refuseDeletedSite('https://demo.calicotab.com/mytest/privateurls/k/'),
    ).rejects.toThrow(`${DELETED_MARKER}: demo.calicotab.com/mytest/ is not ingested`);
    expect(sql(h.db.$queryRaw.mock.calls[0]!).values).toEqual(['demo.calicotab.com', 'mytest']);
  });
  it('lets anything else through', async () => {
    await expect(refuseDeletedSite('https://real.calicotab.com/open/')).resolves.toBeUndefined();
  });
  it('reads a database without the table as nothing deleted', async () => {
    h.db.$queryRaw.mockRejectedValue(Object.assign(new Error('missing'), { code: '42P01' }));
    expect(await isDeletedSite('https://demo.calicotab.com/mytest/')).toBe(false);
  });
  it('is terminal for the queue, so the job is abandoned, not retried', () => {
    const msg = `${DELETED_MARKER}: demo.calicotab.com/mytest/ is not ingested`;
    expect(isPermanentError(msg)).toBe(true);
  });
});

describe('deleteTournament', () => {
  it('deletes a tournament on CVs too, and counts them', async () => {
    h.db.tournament.findUnique.mockResolvedValue({
      name: 'Real',
      sourceUrlRaw: 'https://r.calicotab.com/r/',
    });
    h.db.discoveredUrl.groupBy.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    expect(await deleteTournament(5n, 'a@x')).toEqual({ kind: 'deleted', name: 'Real', users: 2 });
    expect(h.db.tournament.delete).toHaveBeenCalledWith({ where: { id: 5n } });
  });
  it('answers not_found for a missing tournament', async () => {
    h.db.tournament.findUnique.mockResolvedValue(null);
    expect(await deleteTournament(5n, 'a@x')).toEqual({ kind: 'not_found' });
  });
  it('records the public address and deletes the row in one transaction', async () => {
    h.db.tournament.findUnique.mockResolvedValue({
      name: 'DEMO',
      sourceUrlRaw: 'https://demo.calicotab.com/demo/privateurls/s3cret/',
    });
    expect(await deleteTournament(7n, 'a@x')).toEqual({ kind: 'deleted', name: 'DEMO', users: 0 });
    const insert = sql(h.db.$executeRaw.mock.calls[0]!);
    expect(insert.text).toContain('INSERT INTO "DeletedTournament"');
    expect(insert.values).toEqual([
      'demo.calicotab.com',
      'demo',
      'DEMO',
      'https://demo.calicotab.com/demo/',
      'a@x',
    ]);
    expect(JSON.stringify(insert.values)).not.toContain('s3cret');
    expect(h.db.tournament.delete).toHaveBeenCalledWith({ where: { id: 7n } });
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('the list', () => {
  it('reads newest first and turns ids into strings', async () => {
    const at = new Date('2026-10-31T10:00:00Z');
    const row = { name: 'DEMO', tabUrl: 'https://d.calicotab.com/d/', deletedBy: 'a@x' };
    h.db.$queryRaw.mockResolvedValue([{ id: 3n, ...row, deletedAt: at }]);
    expect(await listDeleted()).toEqual([{ id: '3', ...row, deletedAt: at }]);
    expect(sql(h.db.$queryRaw.mock.calls[0]!).text).toContain('ORDER BY "deletedAt" DESC');
  });
  it('allows an address again by removing its row', async () => {
    h.db.$executeRaw.mockResolvedValue(1);
    expect(await allowAgain(3n)).toBe(true);
    h.db.$executeRaw.mockResolvedValue(0);
    expect(await allowAgain(4n)).toBe(false);
  });
});
