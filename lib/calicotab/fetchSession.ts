/**
 * Per-ingest fetch state — cookie jar and per-host last-request timestamps.
 * Each ingestPrivateUrl call creates one FetchSession and passes it to every
 * fetch in that ingest, so Cloudflare clearance cookies set on the landing
 * page replay on subsequent tab fetches while two concurrent users' ingests
 * cannot leak cookies into each other. Replaces the module-level Maps that
 * previously lived in fetch.ts.
 *
 * Preflight + admin-debug fetches don't share state across calls — they
 * each get a fresh single-shot session implicitly (created inside the
 * fetch.ts public functions when no session is supplied).
 */
/**
 * Per-host interval learned from how a host has actually behaved, kept at
 * module scope so it survives across ingests within one warm process.
 *
 * The throttle used to be one fixed number chosen for the strictest
 * imaginable host and applied to every host. That is the wrong shape: the
 * hosts that 403 bursts are the Cloudflare-fronted ones, and a fixed
 * interval either runs too fast for them or — as it did — too slow for
 * everyone else. Learning per host lets the common case be quick while a
 * strict host still gets backed off from, automatically, on its first
 * complaint rather than by a guess made months earlier.
 *
 * Deliberately NOT persisted to the database: it is a hint, it is cheap to
 * relearn, and one bad row should never be able to slow every ingest.
 */
const learnedIntervalByHost = new Map<string, number>();

/**
 * The key a host is throttled and backed off under. Every calicotab
 * subdomain is served by one backend: on 2026-10-30 all of them, and
 * calicotab.com itself, slowed to 10-40 s a page at once. Pacing each
 * subdomain separately let one ingest's tab fetches and another user's
 * preflight hit that backend in parallel. Cookies stay per host.
 */
export function throttleKey(host: string): string {
  return isCalicotabHost(host) ? 'calicotab.com' : host.toLowerCase();
}

/** calicotab.com or one of its subdomains (not a lookalike such as calicotab.com.example). */
export function isCalicotabHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'calicotab.com' || h.endsWith('.calicotab.com');
}

/**
 * The least time worth starting a request with. Below this a request cannot
 * plausibly finish and be parsed before the deadline.
 */
export const MIN_REQUEST_MS = 2_000;

/** Ceiling for the learned backoff — past this a host is simply too slow to serve. */
export const MAX_LEARNED_INTERVAL_MS = 3000;

/**
 * The interval a host is moved to the moment it rate-limits us: the value
 * that was previously applied to every host unconditionally, and which is
 * known to keep Cloudflare-fronted Tabbycat instances happy.
 */
export const SAFE_INTERVAL_MS = 1500;

/** Test seam: forget everything learned so far. */
export function resetLearnedIntervals(): void {
  learnedIntervalByHost.clear();
}

/**
 * Thrown when an ingest would run past its deadline — the moment the
 * serverless function hosting it is about to be killed.
 *
 * A function killed mid-ingest runs no catch block: its job stays `running`
 * until resetStuckRunning recovers it on a later tick, and a killed write
 * phase is the worst place to stop. So the ingest stops itself first, while
 * it still can, and before writing anything: fetches refuse to start (or
 * time out) past the deadline, and the write phase will not begin without
 * WRITE_RESERVE_MS in hand. The drain treats this error as "run me again with
 * a full budget", not as a failed attempt (lib/queueDrain.ts).
 */
export class IngestDeadlineError extends Error {
  constructor(message = 'ingest stopped: not enough time left in this invocation') {
    super(message);
    this.name = 'IngestDeadlineError';
  }
}

export function isIngestDeadlineError(err: unknown): err is IngestDeadlineError {
  return (
    err instanceof IngestDeadlineError ||
    (err instanceof Error && err.name === 'IngestDeadlineError')
  );
}

export class FetchSession {
  /**
   * Epoch ms after which nothing new may start, or null for no limit
   * (preflight, admin probes, tests). Set by the caller that knows its own
   * function budget — see ingestPrivateUrl's `deadline` option.
   */
  readonly deadline: number | null;

  constructor(opts: { deadline?: number | null } = {}) {
    this.deadline = opts.deadline ?? null;
  }

  /** Milliseconds until the deadline (Infinity without one). */
  remainingMs(): number {
    return this.deadline == null ? Infinity : this.deadline - Date.now();
  }

  /** Throw IngestDeadlineError unless at least `needMs` remain. */
  assertTimeLeft(needMs = 0, what = 'continue'): void {
    if (this.remainingMs() < needMs) {
      throw new IngestDeadlineError(
        `ingest stopped before it could ${what}: ${Math.max(0, Math.round(this.remainingMs()))} ms left of this invocation, ${needMs} ms needed`,
      );
    }
  }

  private readonly cookieJars = new Map<string, Map<string, string>>();
  private readonly lastRequestAtByHost = new Map<string, number>();
  // Per-host async chain. Each call to acquireSlot enqueues onto the host's
  // chain; the next slot only resolves after the previous one has finished
  // its wait and marked itself. This makes concurrent Promise.all fetches
  // (3 same-host tabs + many round results) serial rather than racing —
  // critical for Cloudflare-fronted Tabbycat instances that 403 bursts of
  // simultaneous requests even when each individual gap-since-last looks
  // polite.
  private readonly chainByHost = new Map<string, Promise<void>>();

  /**
   * Capture Set-Cookie headers from a response into the per-host jar.
   * getSetCookie() is the multi-value variant available in Node 18+.
   */
  storeCookies(host: string, response: Response): void {
    const setCookies =
      (response.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
    if (!setCookies.length) return;
    const jar = this.cookieJars.get(host) ?? new Map<string, string>();
    for (const raw of setCookies) {
      const pair = raw.split(';')[0] ?? '';
      const eqIdx = pair.indexOf('=');
      if (eqIdx < 1) continue;
      jar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
    }
    this.cookieJars.set(host, jar);
  }

  /**
   * Build the Cookie header string for the next outbound request to `host`,
   * or undefined if no cookies have been captured for that host yet.
   */
  getCookieHeader(host: string): string | undefined {
    const jar = this.cookieJars.get(host);
    if (!jar?.size) return undefined;
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /**
   * Record that `host` pushed back (403 / 429 / 503) and slow down for it.
   *
   * Doubling from the current effective interval, floored at the historical
   * safe value and capped, means one complaint is enough to reach a polite
   * rate immediately rather than creeping toward it over many failures. The
   * escalation is process-wide, so later ingests of the same host in the
   * same lambda start already slowed rather than rediscovering the limit.
   */
  noteRateLimited(host: string, baseIntervalMs: number): void {
    const key = throttleKey(host);
    const current = Math.max(baseIntervalMs, learnedIntervalByHost.get(key) ?? 0);
    const next = Math.min(Math.max(current * 2, SAFE_INTERVAL_MS), MAX_LEARNED_INTERVAL_MS);
    learnedIntervalByHost.set(key, next);
  }

  /** The interval currently in force for `host`, for logging and tests. */
  effectiveInterval(host: string, baseIntervalMs: number): number {
    return Math.max(baseIntervalMs, learnedIntervalByHost.get(throttleKey(host)) ?? 0);
  }

  /** Milliseconds-since-epoch of the last request we sent to `host`, or 0 if none. */
  getLastRequestAt(host: string): number {
    return this.lastRequestAtByHost.get(throttleKey(host)) ?? 0;
  }

  /** Record that a request to `host` is being made now (for throttle accounting). */
  markRequestNow(host: string): void {
    this.lastRequestAtByHost.set(throttleKey(host), Date.now());
  }

  /**
   * Acquire the host's serial slot. Resolves when the caller is allowed to
   * fire its request — i.e. after any previous slot on this host has
   * resolved AND at least `minIntervalMs` has elapsed since the previously
   * marked request. The slot is marked at resolution time so the next
   * waiter's gap is measured from this request's start.
   *
   * Callers MUST await the returned promise before fetching, and MUST NOT
   * also call markRequestNow themselves — acquireSlot owns that bookkeeping.
   */
  acquireSlot(host: string, minIntervalMs: number): Promise<void> {
    const key = throttleKey(host);
    const prev = this.chainByHost.get(key) ?? Promise.resolve();
    const slot = (async () => {
      await prev;
      // The caller's interval is a FLOOR, not the final say: a host that has
      // already rate-limited us carries a larger learned interval and that
      // wins. Read at wait time rather than at call time so an escalation
      // triggered by an in-flight request applies to everything queued
      // behind it, which is the whole point of backing off.
      const interval = Math.max(minIntervalMs, learnedIntervalByHost.get(key) ?? 0);
      const last = this.lastRequestAtByHost.get(key) ?? 0;
      const gap = Date.now() - last;
      if (gap < interval) {
        await new Promise<void>((resolve) => setTimeout(resolve, interval - gap));
      }
      // A request whose turn comes after the deadline must not start.
      this.assertTimeLeft(MIN_REQUEST_MS, 'start another request');
      this.lastRequestAtByHost.set(key, Date.now());
    })();
    // Catch the chain so a rejected slot doesn't poison subsequent waiters.
    // Individual callers still see the original rejection via their own await.
    this.chainByHost.set(
      key,
      slot.catch(() => {}),
    );
    return slot;
  }
}
