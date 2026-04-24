import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the prisma import in the fetch module so we don't need a DB for the
// retry tests. The provenance insert is not what we're testing here.
vi.mock('@/lib/db', () => ({
  prisma: {
    sourceDocument: {
      upsert: vi.fn(async ({ create }) => ({ id: 'mocked-doc-id', ...create })),
    },
  },
}));

// Reduce the backoff so the tests finish quickly. The real delays are
// 0ms / 1000ms / 3000ms; we don't care about the absolute numbers, only
// that the retry loop exists.
vi.useFakeTimers();

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('fetchHtmlWithProvenance retries on soft-fail statuses', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  test('single 200 → returns ok with html body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body>ok</body></html>', { status: 200 }),
    );
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    const promise = fetchHtmlWithProvenance('https://example.calicotab.com/t/tab/team/');
    await advance(5000);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain('ok');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  test('403 then 200 → retries and returns ok', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('blocked', { status: 403 }))
      .mockResolvedValueOnce(new Response('<html>tab rows</html>', { status: 200 }));
    globalThis.fetch = mockFetch;
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    const promise = fetchHtmlWithProvenance('https://example.calicotab.com/t/tab/team/');
    await advance(5000);
    const result = await promise;
    expect(mockFetch.mock.calls.length).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain('tab rows');
  });

  test('persistent 403 → returns {ok:false, status:403, bodyPreview}', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('<!doctype html>Cloudflare blocked', { status: 403 }));
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    const promise = fetchHtmlWithProvenance('https://example.calicotab.com/t/tab/team/');
    await advance(10_000);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.bodyPreview).toContain('Cloudflare blocked');
    }
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  test('404 → no retry, returns ok:false immediately', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    const promise = fetchHtmlWithProvenance('https://example.calicotab.com/t/tab/team/');
    await advance(5000);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
