import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const lookupMock = vi.fn();
vi.mock('@/lib/admin/tournamentLookup', () => ({ lookupTournament: lookupMock }));

const { POST } = await import('@/app/api/admin/lookup/route');

const call = (body: unknown) =>
  POST(new Request('http://x/api/admin/lookup', { method: 'POST', body: JSON.stringify(body) }));

const URL_ = 'https://oxiv.calicotab.com/oxiv2025/privateurls/abc/';

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  lookupMock.mockReset().mockResolvedValue({ kind: 'invalid' });
});

describe('POST /api/admin/lookup', () => {
  it('refuses non-admins without looking anything up', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('x'), { status: 403 }));
    const res = await call({ url: URL_ });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    requireAdminMock.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    expect((await call({ url: URL_ })).status).toBe(401);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects a missing, empty or oversized url with 400', async () => {
    for (const body of [{}, { url: '' }, { url: 'x'.repeat(501) }, { url: 5 }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('answers the lookup result, with dates as ISO strings', async () => {
    const scrapedAt = new Date('2026-10-30T09:00:00Z');
    lookupMock.mockResolvedValue({
      kind: 'stored',
      id: '7',
      name: 'Oxford IV 2025',
      publicUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      scrapedAt,
      parserCurrent: true,
      score: 74,
      band: 'check',
      partlyLoaded: false,
    });
    const res = await call({ url: URL_ });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ kind: 'stored', id: '7', scrapedAt: scrapedAt.toISOString() });
    expect(lookupMock).toHaveBeenCalledWith(URL_);
  });

  it('answers 500 server_error when the lookup throws', async () => {
    lookupMock.mockRejectedValue(new Error('db down'));
    const res = await call({ url: URL_ });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });
});
