import { describe, expect, test, vi } from 'vitest';
import { drainUntilEmpty, summariseDrain, type DrainResponse } from '@/lib/ingest/drainUntilEmpty';
import type { ApiResult } from '@/lib/utils/api';

const ok = (processed: number, remaining: number): ApiResult<DrainResponse> => ({
  ok: true,
  data: { processed, remaining },
});
const fail = (status: number, error = 'boom'): ApiResult<DrainResponse> => ({ ok: false, status, error });

/** Queue up scripted responses; `sleep` is stubbed so backoffs are instant. */
function harness(responses: Array<ApiResult<DrainResponse>>) {
  const post = vi.fn(async () => responses.shift() ?? ok(0, 0));
  return { post, sleep: async () => {}, calls: () => post.mock.calls.length };
}

describe('drainUntilEmpty', () => {
  test('accumulates processed counts until the queue drains', async () => {
    const h = harness([ok(2, 3), ok(3, 0)]);
    const summary = await drainUntilEmpty(() => {}, h);
    expect(summary.processed).toBe(5);
    expect(summary.remaining).toBe(0);
    expect(summary.failed).toBe(false);
  });

  test('reports failed=true when a drain call fails, even if a later call reports an empty queue', async () => {
    // The regression: a 504 leaves the timed-out job in 'running'.
    // resetStuckRunning won't reclaim it for 5 minutes and the route
    // counts only 'pending', so the next call answers
    // {processed: 0, remaining: 0} with HTTP 200 — and the old loop
    // swallowed the 504 and reported an unqualified success.
    const h = harness([fail(504, 'gateway timeout'), ok(0, 0)]);
    const summary = await drainUntilEmpty(() => {}, h);
    expect(summary.failed).toBe(true);
    expect(summary.processed).toBe(0);
  });

  test('a transient failure mid-batch still lets the rest of the queue drain', async () => {
    const h = harness([ok(1, 2), fail(504), ok(2, 0)]);
    const summary = await drainUntilEmpty(() => {}, h);
    expect(summary.processed).toBe(3);
    expect(summary.failed).toBe(true);
  });

  test('throws after three consecutive failures', async () => {
    const h = harness([fail(504), fail(504), fail(504)]);
    await expect(drainUntilEmpty(() => {}, h)).rejects.toThrow('boom');
  });

  test('fails fast on a permanent error instead of burning two backoffs', async () => {
    // postJson reports every non-2xx as ok:false, so an expired session
    // (the drain route's 401 branch) or a deterministic 500-class bug
    // used to cost three round trips and two 5s sleeps before the real
    // error reached the user.
    const h = harness([fail(401, 'unauthorized')]);
    await expect(drainUntilEmpty(() => {}, h)).rejects.toThrow('unauthorized');
    expect(h.calls()).toBe(1);
  });

  test('still retries genuinely transient failures', async () => {
    // 5xx is the Vercel-504 case this tolerance exists for; status 0 is
    // postJson's marker for a network error / offline browser.
    const gateway = harness([fail(504), ok(1, 0)]);
    await expect(drainUntilEmpty(() => {}, gateway)).resolves.toMatchObject({ processed: 1, failed: true });

    const offline = harness([fail(0, 'Network error'), ok(1, 0)]);
    await expect(drainUntilEmpty(() => {}, offline)).resolves.toMatchObject({ processed: 1, failed: true });
  });

  test('stops immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness([ok(1, 0)]);
    const summary = await drainUntilEmpty(() => {}, { ...h, signal: controller.signal });
    expect(h.calls()).toBe(0);
    expect(summary.processed).toBe(0);
  });

  test('abandons the retry backoff as soon as Stop is pressed', async () => {
    // The backoff was a bare setTimeout, so Stop left the button stuck
    // in its pending state for the full 5s before the loop noticed.
    // `sleep` here never resolves: if the wait isn't raced against the
    // abort signal, this test hangs rather than fails.
    const controller = new AbortController();
    const post = vi.fn(async () => fail(504));
    const sleep = () => {
      controller.abort();
      return new Promise<void>(() => {});
    };
    await drainUntilEmpty(() => {}, { post, sleep, signal: controller.signal });
    expect(post).toHaveBeenCalledTimes(1);
  }, 2_000);

  test('abandons the between-call wait as soon as Stop is pressed', async () => {
    const controller = new AbortController();
    const post = vi.fn(async () => ok(1, 5));
    const sleep = () => {
      controller.abort();
      return new Promise<void>(() => {});
    };
    const summary = await drainUntilEmpty(() => {}, { post, sleep, signal: controller.signal });
    expect(post).toHaveBeenCalledTimes(1);
    expect(summary.processed).toBe(1);
  }, 2_000);
});

describe('summariseDrain', () => {
  test('never claims "Done" when a drain call failed', async () => {
    // The user-visible half of the bug: a green "Done · Ingested 0
    // private URLs" toast while a tournament is silently missing from
    // their CV until the 3am cron.
    const toast = summariseDrain({ processed: 0, remaining: 0, failed: true }, false);
    expect(toast.title).not.toBe('Done');
    expect(toast.kind).not.toBe('success');
    expect(toast.description).toMatch(/retry|again|incomplete/i);
  });

  test('a clean full drain is a success', () => {
    const toast = summariseDrain({ processed: 4, remaining: 0, failed: false }, false);
    expect(toast.kind).toBe('success');
    expect(toast.title).toBe('Done');
    expect(toast.description).toContain('4');
  });

  test('a clean partial drain reports what is still queued', () => {
    const toast = summariseDrain({ processed: 4, remaining: 2, failed: false }, false);
    expect(toast.kind).toBe('success');
    expect(toast.description).toContain('2');
  });

  test('an explicit stop reads as stopped, not failed', () => {
    const toast = summariseDrain({ processed: 1, remaining: 5, failed: false }, true);
    expect(toast.title).toBe('Stopped');
    expect(toast.kind).toBe('info');
  });
});
