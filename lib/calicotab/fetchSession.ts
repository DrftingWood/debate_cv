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
export class FetchSession {
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

  /** Milliseconds-since-epoch of the last request we sent to `host`, or 0 if none. */
  getLastRequestAt(host: string): number {
    return this.lastRequestAtByHost.get(host) ?? 0;
  }

  /** Record that a request to `host` is being made now (for throttle accounting). */
  markRequestNow(host: string): void {
    this.lastRequestAtByHost.set(host, Date.now());
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
    const prev = this.chainByHost.get(host) ?? Promise.resolve();
    const slot = (async () => {
      await prev;
      const last = this.lastRequestAtByHost.get(host) ?? 0;
      const gap = Date.now() - last;
      if (gap < minIntervalMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, minIntervalMs - gap));
      }
      this.lastRequestAtByHost.set(host, Date.now());
    })();
    // Catch the chain so a rejected slot doesn't poison subsequent waiters.
    // Individual callers still see the original rejection via their own await.
    this.chainByHost.set(host, slot.catch(() => {}));
    return slot;
  }
}
