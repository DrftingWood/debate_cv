import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// An ingest's deadline (FetchSession.deadline) must stop its fetches before
// the serverless function is killed, and surface as IngestDeadlineError —
// never as an ordinary "fetch:" page failure that would spend an attempt.
vi.mock('@/lib/db', () => ({
  prisma: {
    sourceDocument: {
      upsert: vi.fn(async ({ create }) => ({ id: 'doc', ...create })),
    },
  },
}));

const URL = 'https://example.calicotab.com/t/tab/team/';

describe('ingest deadline at the fetch layer', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('no deadline: nothing changes', async () => {
    const { FetchSession } = await import('@/lib/calicotab/fetchSession');
    const s = new FetchSession();
    expect(s.remainingMs()).toBe(Infinity);
    expect(() => s.assertTimeLeft(1e9)).not.toThrow();
  });

  test('a request whose turn comes too close to the deadline does not start', async () => {
    globalThis.fetch = vi.fn();
    const { FetchSession, isIngestDeadlineError } = await import('@/lib/calicotab/fetchSession');
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    const session = new FetchSession({ deadline: Date.now() + 1_000 });
    const err = await fetchHtmlWithProvenance(URL, { session }).catch((e) => e);
    expect(isIngestDeadlineError(err)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('a request in flight at the deadline is aborted there, as a deadline error', async () => {
    globalThis.fetch = vi.fn(
      (_u: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    ) as unknown as typeof fetch;
    const { FetchSession, isIngestDeadlineError } = await import('@/lib/calicotab/fetchSession');
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    const session = new FetchSession({ deadline: Date.now() + 4_000 });
    const pending = fetchHtmlWithProvenance(URL, { session }).catch((e) => e);
    // Well short of the 15 s per-request ceiling: the deadline cuts it.
    await vi.advanceTimersByTimeAsync(4_100);
    expect(isIngestDeadlineError(await pending)).toBe(true);
  });

  test('a retry that cannot finish before the deadline is not started', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    globalThis.fetch = mockFetch;
    const { FetchSession, isIngestDeadlineError } = await import('@/lib/calicotab/fetchSession');
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    // Enough for one request, not for the 1 s back-off plus another.
    const session = new FetchSession({ deadline: Date.now() + 2_500 });
    const pending = fetchHtmlWithProvenance(URL, { session }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(isIngestDeadlineError(await pending)).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('with time in hand, a page fetch behaves exactly as before', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));
    const { FetchSession } = await import('@/lib/calicotab/fetchSession');
    const { fetchHtmlWithProvenance } = await import('@/lib/calicotab/fetch');
    const session = new FetchSession({ deadline: Date.now() + 60_000 });
    const pending = fetchHtmlWithProvenance(URL, { session });
    await vi.advanceTimersByTimeAsync(1_000);
    const r = await pending;
    expect(r.ok).toBe(true);
  });
});
