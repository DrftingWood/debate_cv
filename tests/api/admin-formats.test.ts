import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const fillFormats = vi.fn();
const fillMissingBatch = vi.fn();
vi.mock('@/lib/admin/formatFill', () => ({ fillFormats, fillMissingBatch }));

const { POST } = await import('@/app/api/admin/formats/route');

const call = (body: unknown) =>
  POST(new Request('http://x/api/admin/formats', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  fillFormats.mockReset().mockResolvedValue({
    filled: [{ id: 42n, format: 'British Parliamentary' }],
    undecided: [],
  });
  fillMissingBatch.mockReset().mockResolvedValue({ filled: 3, undecided: 1, left: 9, next: '77' });
});

describe('POST /api/admin/formats: access and one tournament', () => {
  it('rejects non-admins and does nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await call({ tournamentId: '42' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fillFormats).not.toHaveBeenCalled();
    expect(fillMissingBatch).not.toHaveBeenCalled();
  });

  it('maps a signed-out caller to 401', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    expect((await call({ fillMissing: true })).status).toBe(401);
  });

  it('{ tournamentId } fills that one and says what it decided', async () => {
    const res = await call({ tournamentId: '42' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decided: true, format: 'British Parliamentary' });
    expect(fillFormats).toHaveBeenCalledWith([42n]);
  });

  it('{ tournamentId } that the data cannot decide answers decided:false', async () => {
    fillFormats.mockResolvedValue({ filled: [], undecided: [42n] });
    const res = await call({ tournamentId: '42' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decided: false, format: null });
  });

  it('a tournament that already has a format is decided, not rewritten', async () => {
    fillFormats.mockResolvedValue({ filled: [], undecided: [], already: [42n] });
    expect(await (await call({ tournamentId: '42' })).json()).toEqual({
      decided: true,
      format: null,
    });
  });

  it('a tournament that does not exist is 404 not_found', async () => {
    fillFormats.mockResolvedValue({ filled: [], undecided: [] });
    const res = await call({ tournamentId: '42' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('POST /api/admin/formats: the batch and bad bodies', () => {
  it('{ fillMissing } runs one bounded batch from the start', async () => {
    const res = await call({ fillMissing: true });
    expect(await res.json()).toEqual({ filled: 3, undecided: 1, left: 9, next: '77' });
    expect(fillMissingBatch).toHaveBeenCalledWith(null);
  });

  it('{ fillMissing, after } continues from the cursor', async () => {
    await call({ fillMissing: true, after: '77' });
    expect(fillMissingBatch).toHaveBeenCalledWith(77n);
  });

  it('a bad body is 400 bad_request', async () => {
    for (const body of [
      { tournamentId: '0x10' },
      { tournamentId: 5 },
      { fillMissing: false },
      { fillMissing: true, after: 'x' },
      { tournamentId: '1', fillMissing: true },
      {},
      null,
    ]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    }
    expect(fillFormats).not.toHaveBeenCalled();
    expect(fillMissingBatch).not.toHaveBeenCalled();
  });

  it('a failure is a code, not the raw message', async () => {
    fillMissingBatch.mockRejectedValue(new Error('connection string postgres://secret'));
    const res = await call({ fillMissing: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });
});
