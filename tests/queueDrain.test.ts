import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { drainQueue } = await import('@/lib/queueDrain');
const queue = await import('@/lib/queue');

type Row = { id: string; userId: string; url: string; attempts: number };

/**
 * Stand in for the database queue. `claimOnePending` is the only queue
 * function the scheduler uses to get work, so faking it here exercises the
 * real concurrency, host-exclusion and budget logic without a server.
 */
function fakeQueue(rows: Row[]) {
  const pending = [...rows];
  const claimSpy = vi
    .spyOn(queue, 'claimOnePending')
    .mockImplementation(async (params: { excludeHosts?: string[] } = {}) => {
      const busy = new Set(params.excludeHosts ?? []);
      const idx = pending.findIndex((r) => !busy.has(queue.jobHost(r.url)));
      if (idx === -1) return null;
      const [row] = pending.splice(idx, 1);
      return { ...row, attempts: row.attempts + 1 };
    });
  return { claimSpy, remaining: () => pending.length };
}

const jobsOnDistinctHosts = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `job${i}`,
    userId: 'u1',
    // Separate Heroku-hosted Tabbycat installs: genuinely different servers.
    // (calicotab subdomains share one backend and count as one host.)
    url: `https://t${i}.herokuapp.com/t/privateurls/abc`,
    attempts: 0,
  }));

const deps = (ingest: (url: string, userId: string) => Promise<unknown>) => ({
  ingest,
  isDeadlockError: () => false,
});

const opts = (over: Partial<Parameters<typeof drainQueue>[1]> = {}) => ({
  budgetMs: 55_000,
  headroomMs: 30_000,
  maxAttempts: 3,
  concurrency: 6,
  ...over,
});

beforeEach(() => {
  resetPrismaMock();
  vi.restoreAllMocks();
  prismaMock.ingestJob.update.mockResolvedValue({ id: 'x', userId: 'u1' });
  prismaMock.ingestJob.count.mockResolvedValue(1);
});

describe('drainQueue — throughput', () => {
  it('overlaps jobs on distinct hosts instead of running them end to end', async () => {
    const q = fakeQueue(jobsOnDistinctHosts(6));
    const JOB_MS = 40;
    const report = await drainQueue(
      deps(() => new Promise((r) => setTimeout(r, JOB_MS))),
      opts({ concurrency: 6, budgetMs: 5_000, headroomMs: 0 }),
    );

    expect(report.processed).toBe(6);
    expect(report.peakInFlight).toBe(6);
    // Serially this is 6 x JOB_MS; concurrently it is ~1 x JOB_MS. Assert
    // well inside the serial figure so the test is about the schedule, not
    // about timer precision.
    expect(report.elapsedMs).toBeLessThan(JOB_MS * 3);
    expect(q.remaining()).toBe(0);
  });

  it('never runs two jobs against the same host at once', async () => {
    // The politeness guarantee: FetchSession serializes requests within one
    // ingest, so two ingests of the same host would race and reproduce the
    // Cloudflare burst-403s that serialization was added to prevent.
    const sameHost: Row[] = Array.from({ length: 4 }, (_, i) => ({
      id: `job${i}`,
      userId: 'u1',
      url: `https://one.calicotab.com/t/privateurls/u${i}`,
      attempts: 0,
    }));
    fakeQueue(sameHost);

    let live = 0;
    let peakSameHost = 0;
    const report = await drainQueue(
      deps(async () => {
        live += 1;
        peakSameHost = Math.max(peakSameHost, live);
        await new Promise((r) => setTimeout(r, 20));
        live -= 1;
      }),
      opts({ concurrency: 6, budgetMs: 5_000, headroomMs: 0 }),
    );

    expect(report.processed).toBe(4);
    expect(peakSameHost).toBe(1);
  });

  it('runs calicotab subdomains one at a time: they share one backend', async () => {
    fakeQueue(
      ['a', 'b', 'c'].map((sub, i) => ({
        id: `job${i}`,
        userId: 'u1',
        url: `https://${sub}.calicotab.com/t/privateurls/u${i}`,
        attempts: 0,
      })),
    );
    let live = 0;
    let peak = 0;
    const report = await drainQueue(
      deps(async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live -= 1;
      }),
      opts({ concurrency: 6, budgetMs: 5_000, headroomMs: 0 }),
    );
    expect(report.processed).toBe(3);
    expect(peak).toBe(1);
  });

  it('respects the concurrency cap', async () => {
    fakeQueue(jobsOnDistinctHosts(10));
    const report = await drainQueue(
      deps(() => new Promise((r) => setTimeout(r, 20))),
      opts({ concurrency: 3, budgetMs: 5_000, headroomMs: 0 }),
    );
    expect(report.processed).toBe(10);
    expect(report.peakInFlight).toBeLessThanOrEqual(3);
  });
});

describe('drainQueue — budget and failure handling', () => {
  it('will not start a job it cannot finish, and says so', async () => {
    fakeQueue(jobsOnDistinctHosts(4));
    const report = await drainQueue(
      deps(() => new Promise((r) => setTimeout(r, 10))),
      // Headroom equals the budget, so no job may ever start.
      opts({ budgetMs: 1_000, headroomMs: 1_000, concurrency: 2 }),
    );
    expect(report.processed).toBe(0);
    expect(report.stoppedForBudget).toBe(true);
  });

  it('reports a drained queue as complete, not truncated', async () => {
    fakeQueue(jobsOnDistinctHosts(2));
    const report = await drainQueue(
      deps(async () => {}),
      opts({ budgetMs: 5_000, headroomMs: 0, concurrency: 2 }),
    );
    expect(report.processed).toBe(2);
    expect(report.stoppedForBudget).toBe(false);
  });

  it('fails a job that has already blown the attempt ceiling, without running it', async () => {
    // attempts 4 after the claim's increment — only reachable by being
    // killed mid-ingest, which never runs the catch that would retire it.
    fakeQueue([
      { id: 'runaway', userId: 'u1', url: 'https://a.calicotab.com/t/privateurls/x', attempts: 4 },
    ]);
    const ingest = vi.fn(async () => {});
    const onTerminal = vi.fn();

    const report = await drainQueue(
      { ingest, isDeadlockError: () => false, onTerminal },
      opts({ budgetMs: 5_000, headroomMs: 0 }),
    );

    expect(ingest).not.toHaveBeenCalled();
    expect(report.results[0]!.status).toBe('failed');
    expect(onTerminal).toHaveBeenCalledWith(
      'ingest-budget-exhausted',
      expect.anything(),
      expect.anything(),
    );
  });

  it('keeps draining other hosts when one job throws', async () => {
    fakeQueue(jobsOnDistinctHosts(4));
    const report = await drainQueue(
      deps(async (url) => {
        if (url.includes('t1.')) throw new Error('boom');
      }),
      opts({ budgetMs: 5_000, headroomMs: 0, concurrency: 4 }),
    );
    expect(report.processed).toBe(4);
    expect(report.results.filter((r) => r.status === 'done')).toHaveLength(3);
    expect(report.results.filter((r) => r.status === 'retry')).toHaveLength(1);
  });
});

describe('drainQueue — per-job deadline', () => {
  // A controllable clock: jobs "take" time by advancing it.
  function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }
  class DeadlineError extends Error {
    override name = 'IngestDeadlineError';
  }
  const isDeadline = (e: unknown) => e instanceof DeadlineError;

  it("gives every job the end of the tick's budget as its deadline", async () => {
    fakeQueue(jobsOnDistinctHosts(2));
    const c = clock();
    const seen: number[] = [];
    await drainQueue(
      {
        ingest: async (_u, _id, { deadline }) => {
          seen.push(deadline);
        },
        isDeadlockError: () => false,
        now: c.now,
      },
      opts({ budgetMs: 55_000, headroomMs: 0, concurrency: 2 }),
    );
    expect(seen).toEqual([1_000_000 + 55_000, 1_000_000 + 55_000]);
  });

  it('a job started late that runs out is deferred: attempt refunded, place kept', async () => {
    fakeQueue(jobsOnDistinctHosts(2));
    const c = clock();
    const report = await drainQueue(
      {
        ingest: async (url) => {
          if (url.includes('t0.')) {
            c.advance(20_000); // the first job takes 20 s
            return;
          }
          throw new DeadlineError('out of time');
        },
        isDeadlockError: () => false,
        isDeadlineError: isDeadline,
        now: c.now,
      },
      opts({ budgetMs: 55_000, headroomMs: 30_000, concurrency: 1 }),
    );
    expect(report.results.map((r) => r.status)).toEqual(['done', 'deferred']);
    const release = prismaMock.ingestJob.update.mock.calls.find(
      (call) => (call[0] as { where: { id: string } }).where.id === 'job1',
    )![0] as { data: Record<string, unknown> };
    expect(release.data).toMatchObject({ status: 'pending', attempts: { decrement: 1 } });
    // Not sent to the back of the queue: it should run first next tick.
    expect(release.data).not.toHaveProperty('scheduledAt');
  });

  it('a job that had the whole budget and still ran out spends its attempt', async () => {
    fakeQueue([
      { id: 'big', userId: 'u1', url: 'https://big.calicotab.com/t/privateurls/x', attempts: 0 },
    ]);
    const report = await drainQueue(
      {
        ingest: async () => {
          throw new DeadlineError('out of time');
        },
        isDeadlockError: () => false,
        isDeadlineError: isDeadline,
      },
      opts({ budgetMs: 55_000, headroomMs: 0, concurrency: 1 }),
    );
    expect(report.results[0]!.status).toBe('retry');
  });

  it('…and on its last attempt is failed with a clear reason, not cycled forever', async () => {
    fakeQueue([
      { id: 'big', userId: 'u1', url: 'https://big.calicotab.com/t/privateurls/x', attempts: 2 },
    ]);
    const onTerminal = vi.fn();
    const report = await drainQueue(
      {
        ingest: async () => {
          throw new DeadlineError('out of time');
        },
        isDeadlockError: () => false,
        isDeadlineError: isDeadline,
        onTerminal,
      },
      opts({ budgetMs: 55_000, headroomMs: 0, concurrency: 1 }),
    );
    expect(report.results[0]!.status).toBe('failed');
    expect(report.results[0]!.error).toMatch(/does not fit/i);
    expect(onTerminal).toHaveBeenCalledWith(
      'ingest-budget-exhausted',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('drainQueue — slow hosts (2026-10-30)', () => {
  const one = (url = 'https://t.calicotab.com/t/privateurls/abc'): Row[] => [
    { id: 'job0', userId: 'u1', url, attempts: 0 },
  ];
  const updateData = () =>
    prismaMock.ingestJob.update.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );

  it('holds back a job whose private-URL page timed out, instead of retrying at once', async () => {
    fakeQueue(one());
    const before = Date.now();
    await drainQueue(
      deps(async () => {
        throw new Error('fetch landing https://t.calicotab.com/t/privateurls/abc/ → HTTP 0');
      }),
      opts({ budgetMs: 5_000, headroomMs: 0 }),
    );
    const retry = updateData().find((d) => d.status === 'pending');
    expect((retry?.scheduledAt as Date).getTime() - before).toBeGreaterThanOrEqual(14 * 60_000);
  });

  it('retries any other failure at once, as before', async () => {
    fakeQueue(one());
    const before = Date.now();
    await drainQueue(
      deps(async () => {
        throw new Error('parse exploded');
      }),
      opts({ budgetMs: 5_000, headroomMs: 0 }),
    );
    const retry = updateData().find((d) => d.status === 'pending');
    expect((retry?.scheduledAt as Date).getTime() - before).toBeLessThan(5_000);
  });
});

describe('queue helpers for slow hosts', () => {
  it('treats only a page that did not answer as transient', () => {
    expect(queue.isTransientLandingError('fetch landing https://x/ → HTTP 0')).toBe(true);
    expect(queue.isTransientLandingError('fetch landing https://x/ → HTTP 503')).toBe(true);
    expect(queue.isTransientLandingError('fetch landing https://x/ → HTTP 429')).toBe(true);
    expect(queue.isTransientLandingError('fetch landing https://x/ → HTTP 404')).toBe(false);
    expect(queue.isTransientLandingError('fetch landing https://x/ → HTTP 403')).toBe(false);
    expect(queue.isTransientLandingError('parse exploded')).toBe(false);
  });

  it('waits 15 minutes after the first miss, an hour after later ones', () => {
    expect(queue.landingRetryDelayMs(1)).toBe(15 * 60_000);
    expect(queue.landingRetryDelayMs(2)).toBe(60 * 60_000);
  });

  it('gives every calicotab subdomain one job host', () => {
    expect(queue.jobHost('https://a.calicotab.com/x/privateurls/y/')).toBe('calicotab.com');
    expect(queue.jobHost('https://B.calicotab.com/x/')).toBe('calicotab.com');
    expect(queue.jobHost('https://t.herokuapp.com/x/')).toBe('t.herokuapp.com');
    expect(queue.jobHost('not a url')).toBe('');
  });
});
