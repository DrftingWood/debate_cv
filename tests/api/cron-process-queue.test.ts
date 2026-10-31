import { describe, it, expect, beforeEach, vi } from 'vitest';

// The route's drain is exercised in tests/queueDrain.test.ts; this covers
// the wiring: the deadline-aware ingest, and `?respond=early` answering
// before the drain instead of after it (cron-job.org gives up at 30 s).
const drainQueue = vi.fn();
vi.mock('@/lib/queueDrain', () => ({ drainQueue, DRAIN_CONCURRENCY: 2 }));
vi.mock('@/lib/queue', () => ({ resetStuckRunning: vi.fn(async () => {}) }));
vi.mock('@/lib/calicotab/provenance', () => ({
  pruneIngestArtifacts: vi.fn(),
  prunePlaceholderPersons: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({ pruneRateLimits: vi.fn() }));
vi.mock('@/lib/calicotab/ingest', () => ({
  ingestPrivateUrl: vi.fn(async () => ({})),
  isDeadlockError: () => false,
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
const retryDuePieces = vi.fn();
vi.mock('@/lib/calicotab/partialScrape', () => ({ retryDuePieces }));
const auditStale = vi.fn();
vi.mock('@/lib/audit/run', () => ({ auditStale }));
// The background scan is covered in tests/gmail.backgroundScan.test.ts; here only the wiring.
const scanDueMailboxes = vi.fn();
vi.mock('@/lib/gmail/backgroundScan', () => ({ scanDueMailboxes }));
vi.mock('@/lib/gmail/scanUser', () => ({ scanMailbox: vi.fn() }));
vi.mock('@/lib/gmail/client', () => ({ revokeAndForgetGmailToken: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { gmailToken: { findMany: vi.fn(), update: vi.fn() } } }));
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock('next/server', async () => {
  const actual: typeof import('next/server') = await vi.importActual('next/server');
  return { ...actual, after: (cb: () => Promise<void>) => afterCallbacks.push(cb) };
});

const { POST } = await import('@/app/api/cron/process-queue/route');
const { ingestPrivateUrl } = await import('@/lib/calicotab/ingest');

const req = (query = '') =>
  new Request(`https://app.test/api/cron/process-queue${query}`, {
    method: 'POST',
    headers: { authorization: 'Bearer s3cret' },
  });

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret';
  drainQueue.mockReset();
  drainQueue.mockResolvedValue({
    processed: 0,
    results: [],
    stoppedForBudget: false,
    peakInFlight: 0,
    elapsedMs: 1,
  });
  retryDuePieces.mockReset();
  retryDuePieces.mockResolvedValue({ tournaments: 0, loaded: 0, failed: 0 });
  auditStale.mockReset();
  auditStale.mockResolvedValue(0);
  scanDueMailboxes.mockReset();
  scanDueMailboxes.mockResolvedValue({
    scanned: 1,
    urlsFound: 2,
    grantsCleared: 0,
    failed: 0,
    stoppedForBudget: false,
  });
  delete process.env.BACKGROUND_GMAIL_SCAN;
  delete process.env.BACKGROUND_SCAN_INTERVAL_MIN;
  afterCallbacks.length = 0;
});

describe('POST /api/cron/process-queue', () => {
  it('drains synchronously by default and reports', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(drainQueue).toHaveBeenCalledTimes(1);
    expect(afterCallbacks).toHaveLength(0);
  });

  it('retries failed pieces after the drain, within the tick budget', async () => {
    const before = Date.now();
    retryDuePieces.mockResolvedValue({ tournaments: 2, loaded: 3, failed: 1 });
    const body = await (await POST(req())).json();
    expect(body.piecesRetried).toEqual({ tournaments: 2, loaded: 3, failed: 1 });
    const { deadline } = retryDuePieces.mock.calls[0]![0] as { deadline: number };
    expect(deadline).toBeGreaterThanOrEqual(before + 55_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 55_000);
  });

  it('?respond=early answers 202 first and drains after the response', async () => {
    const res = await POST(req('?respond=early'));
    expect(res.status).toBe(202);
    expect(drainQueue).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]!();
    expect(drainQueue).toHaveBeenCalledTimes(1);
  });

  it('a failure after the 202 still reaches Sentry', async () => {
    const Sentry = await import('@sentry/nextjs');
    drainQueue.mockRejectedValueOnce(new Error('db down'));
    await POST(req('?respond=early'));
    await afterCallbacks[0]!();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it('still refuses an unauthorised caller, early or not', async () => {
    const res = await POST(
      new Request('https://app.test/api/cron/process-queue?respond=early', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
    expect(afterCallbacks).toHaveLength(0);
  });

  it('hands the drain a deadline-aware ingest', async () => {
    await POST(req());
    const deps = drainQueue.mock.calls[0]![0] as {
      ingest: (u: string, id: string, o: { deadline: number }) => Promise<unknown>;
      isDeadlineError: (e: unknown) => boolean;
    };
    await deps.ingest('https://a.calicotab.com/t/privateurls/x', 'u1', { deadline: 123 });
    expect(ingestPrivateUrl).toHaveBeenCalledWith('https://a.calicotab.com/t/privateurls/x', 'u1', {
      deadline: 123,
    });
    const { IngestDeadlineError } = await import('@/lib/calicotab/fetchSession');
    expect(deps.isDeadlineError(new IngestDeadlineError())).toBe(true);
    expect(deps.isDeadlineError(new Error('x'))).toBe(false);
  });
});

describe('stale audits in the tick', () => {
  it('audits stale tournaments after the piece retry, 50 at most, within the tick budget', async () => {
    const order: string[] = [];
    retryDuePieces.mockImplementation(async () => {
      order.push('retry');
      return { tournaments: 0, loaded: 0, failed: 0 };
    });
    auditStale.mockImplementation(async () => {
      order.push('audit');
      return 7;
    });
    const before = Date.now();
    const body = await (await POST(req())).json();
    expect(order).toEqual(['retry', 'audit']);
    expect(body.audited).toBe(7);
    const { limit, deadline } = auditStale.mock.calls[0]![0] as { limit: number; deadline: number };
    expect(limit).toBe(50);
    // 5 s inside the tick budget, so a chunk started at the deadline still finishes.
    expect(deadline).toBeGreaterThanOrEqual(before + 50_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 50_000);
  });

  it('an audit failure is reported and never fails the tick', async () => {
    auditStale.mockRejectedValue(new Error('db down'));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).audited).toBeNull();
  });
});

describe('background Gmail scan in the tick', () => {
  it('scans before the drain and reports it', async () => {
    const order: string[] = [];
    scanDueMailboxes.mockImplementation(async () => {
      order.push('scan');
      return { scanned: 1, urlsFound: 2, grantsCleared: 0, failed: 0, stoppedForBudget: false };
    });
    drainQueue.mockImplementation(async () => {
      order.push('drain');
      return { processed: 0, results: [], stoppedForBudget: false, peakInFlight: 0, elapsedMs: 1 };
    });
    const res = await POST(req());
    expect(order).toEqual(['scan', 'drain']);
    expect((await res.json()).scan).toMatchObject({ scanned: 1, urlsFound: 2 });
  });

  it('uses a 30 minute interval by default, two users a tick, and a short budget', async () => {
    await POST(req());
    expect(scanDueMailboxes.mock.calls[0][1]).toEqual({
      intervalMs: 30 * 60_000,
      maxUsers: 2,
      budgetMs: 12_000,
    });
  });

  it('takes the interval from the environment but never below five minutes', async () => {
    process.env.BACKGROUND_SCAN_INTERVAL_MIN = '10';
    await POST(req());
    expect(scanDueMailboxes.mock.calls[0][1].intervalMs).toBe(10 * 60_000);
    scanDueMailboxes.mockClear();
    process.env.BACKGROUND_SCAN_INTERVAL_MIN = '1';
    await POST(req());
    expect(scanDueMailboxes.mock.calls[0][1].intervalMs).toBe(30 * 60_000);
  });

  it('is off when BACKGROUND_GMAIL_SCAN=0', async () => {
    process.env.BACKGROUND_GMAIL_SCAN = '0';
    const res = await POST(req());
    expect(scanDueMailboxes).not.toHaveBeenCalled();
    expect((await res.json()).scan).toBeNull();
  });

  it('still drains the queue when the scan itself throws', async () => {
    scanDueMailboxes.mockRejectedValue(new Error('gmail down'));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(drainQueue).toHaveBeenCalledTimes(1);
  });
});
