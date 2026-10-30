import { describe, it, expect, beforeEach, vi } from 'vitest';

const requireAdminMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const rescrapeMock = vi.fn();
class FakeBusy extends Error {}
class FakeNotFound extends Error {}
vi.mock('@/lib/calicotab/partialScrape', () => ({
  rescrapePieces: rescrapeMock,
  ScrapeBusyError: FakeBusy,
  TournamentNotFoundError: FakeNotFound,
}));

const { POST } = await import('@/app/api/admin/tournaments/[id]/rescrape/route');

const call = (id: string, body: unknown) =>
  POST(
    new Request('http://x/api/admin/tournaments/' + id + '/rescrape', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  rescrapeMock.mockReset();
});

describe('POST /api/admin/tournaments/[id]/rescrape', () => {
  it('rejects non-admins and scrapes nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await call('5', { pieces: 'failed' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(rescrapeMock).not.toHaveBeenCalled();
  });

  it('passes "failed" through with a deadline and returns the three lists', async () => {
    rescrapeMock.mockResolvedValue({
      tournamentId: 5n,
      loaded: [{ kind: 'round', key: '1' }],
      failed: [],
      notOnTab: [{ kind: 'break', key: 'open' }],
    });
    const res = await call('5', { pieces: 'failed' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      loaded: [{ kind: 'round', key: '1' }],
      failed: [],
      notOnTab: [{ kind: 'break', key: 'open' }],
    });
    const [id, pieces, opts] = rescrapeMock.mock.calls[0];
    expect(id).toBe(5n);
    expect(pieces).toBe('failed');
    expect(opts.deadline).toBeGreaterThan(Date.now() + 50_000);
    expect(opts.deadline).toBeLessThanOrEqual(Date.now() + 55_000);
  });

  it('maps a busy scrape to 409 scrape_busy', async () => {
    rescrapeMock.mockRejectedValue(new FakeBusy('x'));
    const res = await call('5', { pieces: [{ kind: 'team', key: '' }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'scrape_busy' });
  });

  it('maps an unknown tournament to 404 not_found', async () => {
    rescrapeMock.mockRejectedValue(new FakeNotFound('x'));
    const res = await call('5', { pieces: 'failed' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects more than 40 pieces, bad kinds and bad ids with 400', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ kind: 'round', key: String(i) }));
    expect((await call('5', { pieces: many })).status).toBe(400);
    expect((await call('5', { pieces: [{ kind: 'nope', key: '' }] })).status).toBe(400);
    expect((await call('0x10', { pieces: 'failed' })).status).toBe(400);
    expect((await call('abc', { pieces: 'failed' })).status).toBe(400);
    expect(rescrapeMock).not.toHaveBeenCalled();
  });

  it('answers an unexpected error with 500 server_error', async () => {
    rescrapeMock.mockRejectedValue(new Error('secret detail'));
    const res = await call('5', { pieces: 'failed' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });
});
