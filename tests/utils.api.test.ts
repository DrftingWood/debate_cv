import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { postJson } from '@/lib/utils/api';

describe('postJson', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns parsed data on 2xx with JSON body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ processed: 3, remaining: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await postJson<{ processed: number; remaining: number }>('/x');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.processed).toBe(3);
    }
  });

  test('sends JSON body when provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    globalThis.fetch = fetchSpy;
    await postJson('/x', { url: 'https://y/z' });
    const call = fetchSpy.mock.calls[0]!;
    expect(call[1].method).toBe('POST');
    expect(call[1].headers).toEqual({ 'content-type': 'application/json' });
    expect(call[1].body).toBe('{"url":"https://y/z"}');
  });

  test('returns empty data on 2xx with empty body (no JSON parse throw)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const result = await postJson('/x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({});
  });

  test('returns readable error on non-JSON 500 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!doctype html><html>Gateway Timeout</html>', { status: 504 }),
    );
    const result = await postJson('/x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.error).toContain('Gateway Timeout');
    }
  });

  test('returns server error field when the JSON 500 body includes one', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    const result = await postJson('/x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe('unauthorized');
    }
  });

  test('handles a fetch() network rejection without throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await postJson('/x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.error).toBe('ECONNREFUSED');
    }
  });
});
