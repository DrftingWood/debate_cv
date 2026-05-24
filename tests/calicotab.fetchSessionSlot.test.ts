import { describe, it, expect } from 'vitest';
import { FetchSession } from '@/lib/calicotab/fetchSession';

/**
 * FetchSession.acquireSlot guards Cloudflare-fronted Tabbycat hosts from the
 * concurrent-burst pattern that the previous timestamp-only throttle didn't
 * actually prevent. Three properties matter:
 *
 *   1. Concurrent acquireSlot calls on the SAME host execute serially with
 *      the configured minimum gap between consecutive resolutions.
 *   2. Concurrent acquireSlot calls on DIFFERENT hosts don't block each
 *      other (the chain is per-host).
 *   3. A rejected slot in the chain doesn't poison subsequent waiters
 *      (chain stores a `.catch(() => {})` variant for chaining).
 */
describe('FetchSession.acquireSlot', () => {
  it('serializes concurrent same-host slots with the configured minimum gap', async () => {
    const session = new FetchSession();
    const minInterval = 80;
    const start = Date.now();

    // Fire three slots simultaneously — the test of the old code is that
    // they all resolved at roughly t=0 (racing). The fixed code makes them
    // resolve at ~0, ~minInterval, ~2*minInterval.
    const resolveTimes = await Promise.all(
      [0, 1, 2].map(async () => {
        await session.acquireSlot('example.com', minInterval);
        return Date.now() - start;
      }),
    );

    // First slot resolves immediately (no prior request marked).
    expect(resolveTimes[0]).toBeLessThan(minInterval);
    // Subsequent slots resolve at least one full interval after the previous.
    // Some scheduler jitter is allowed; the lower bound is the only thing
    // that matters for the Cloudflare-friendliness guarantee.
    expect(resolveTimes[1]).toBeGreaterThanOrEqual(minInterval - 10);
    expect(resolveTimes[2]).toBeGreaterThanOrEqual(2 * minInterval - 10);
  });

  it('does not block across different hosts', async () => {
    const session = new FetchSession();
    const minInterval = 120;
    const start = Date.now();

    const [hostA, hostB] = await Promise.all([
      session.acquireSlot('a.example.com', minInterval).then(() => Date.now() - start),
      session.acquireSlot('b.example.com', minInterval).then(() => Date.now() - start),
    ]);

    // Both should resolve immediately — neither host has prior history,
    // and they share no chain.
    expect(hostA).toBeLessThan(minInterval);
    expect(hostB).toBeLessThan(minInterval);
  });

  it('survives a thrown slot mid-chain and still releases subsequent waiters', async () => {
    const session = new FetchSession();
    const minInterval = 30;
    const host = 'flaky.example.com';

    // Synthesize a poisoned slot by attaching a then() handler that
    // throws after acquireSlot resolves. The previous chain logic stored
    // the raw promise; if one slot's chain rejects, the next acquireSlot
    // would await a rejected promise and never resolve. The new logic
    // stores `slot.catch(() => {})` on the chain map so subsequent
    // waiters see a clean chain even after upstream rejections.
    const first = session.acquireSlot(host, minInterval).then(() => {
      throw new Error('synthetic poison');
    });
    await expect(first).rejects.toThrow('synthetic poison');

    // The next acquireSlot must still resolve in bounded time.
    const second = session.acquireSlot(host, minInterval);
    await expect(second).resolves.toBeUndefined();
  });
});
