/**
 * The Found loader's time budget and error net: a slow loader becomes a
 * `timeout` (and is told to stop), a failing one becomes an `error` with a
 * kind, and neither ever throws to the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFoundWithBudget } from '@/lib/discovery/budget';
import type { FoundLoad } from '@/lib/discovery/loader';

const LOAD = { input: { rows: [] }, rows: [] } as unknown as FoundLoad;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadFoundWithBudget', () => {
  it('passes a finished load through', async () => {
    const out = await loadFoundWithBudget(async () => LOAD, 'u', 1000);
    expect(out).toEqual({ status: 'ok', load: LOAD });
  });

  it('times out a loader that never settles, aborts it, and logs once', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const pending = loadFoundWithBudget(
      (_u, opts) => {
        signal = opts.signal;
        return new Promise(() => {});
      },
      'u',
      500,
    );
    await vi.advanceTimersByTimeAsync(501);
    expect(await pending).toEqual({ status: 'timeout', budgetMs: 500 });
    expect(signal?.aborted).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('[found] timeout');
  });

  it('classifies a missing table (P2021) apart from other query errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = Object.assign(
      new Error('The table `public.AppearanceCandidate` does not exist'),
      {
        code: 'P2021',
      },
    );
    expect(await loadFoundWithBudget(() => Promise.reject(missing), 'u', 1000)).toMatchObject({
      status: 'error',
      kind: 'missing_table',
      detail: expect.stringContaining('P2021'),
    });
    const raw = new Error('relation "AppearanceCandidate" does not exist');
    expect(await loadFoundWithBudget(() => Promise.reject(raw), 'u', 1000)).toMatchObject({
      kind: 'missing_table',
    });
    const other = new Error('Timed out fetching a new connection from the connection pool');
    expect(await loadFoundWithBudget(() => Promise.reject(other), 'u', 1000)).toMatchObject({
      kind: 'query',
    });
  });
});
