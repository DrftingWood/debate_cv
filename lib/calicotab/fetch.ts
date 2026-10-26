import { gzipSync } from 'node:zlib';
import { prisma } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';
import { FetchSession, IngestDeadlineError, isIngestDeadlineError, MIN_REQUEST_MS } from './fetchSession';
import { isAllowedTabHost } from '@/lib/gmail/extract';

/**
 * Realistic Chrome-on-macOS fingerprint. Tabbycat sits behind Cloudflare on
 * many deployments and Cloudflare's default managed rules 403 any request
 * that doesn't look like a browser. The earlier "debate-cv/1.0" UA was
 * getting blocked on the `/tab/…` / `/results/…` / `/break/…` paths, which
 * is the root cause of the empty-tables ingest symptom.
 */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Per-host minimum interval between consecutive request starts — a FLOOR,
// not a fixed rate. FetchSession raises it per host the first time that host
// pushes back (see noteRateLimited), so the value here is the optimistic
// starting point rather than a guess that has to be safe for every host in
// the world simultaneously.
//
// History: 750ms (original) → 2500ms (2026-05, post Cloudflare-403 audit)
// → 1500ms (2026-05-24, post Vercel 60s 504 timeout audit) → 600ms + learned
// backoff (2026-07).
//
// The 403s that drove the increases were caused by CONCURRENT BURSTS, and
// the fix for those was the serialization in FetchSession.acquireSlot — the
// interval on top was headroom, as the 2500ms→1500ms note already conceded.
// Charging every host the strictest host's rate made a 13-fetch ingest spend
// 18.0s of its 28.7s simply waiting (63%, measured against a live
// tournament).
//
// So: start at 600ms and let evidence set the rest. A host that returns 403,
// 429 or 503 is immediately moved to SAFE_INTERVAL_MS (the old 1500ms) and
// doubles from there to a 3s ceiling, process-wide. Those statuses are
// already in RETRYABLE_STATUSES, so the first push-back costs a retry rather
// than a failed ingest, and the retry goes out at the slowed rate.
//
// TABBYCAT_MIN_INTERVAL_MS overrides the floor for tuning a specific
// deployment without a code change. Empty / unparseable values fall back to
// the default.
const MIN_INTERVAL_MS = (() => {
  const raw = process.env.TABBYCAT_MIN_INTERVAL_MS;
  if (!raw) return 400;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 400;
})();

/**
 * The configured per-host floor, for callers that budget against it.
 * Exported so the drain's time budget is derived rather than restated —
 * ESTIMATED_JOB_MS was hand-copied from the 1500ms era and silently went
 * stale when the floor moved, leaving the drain reserving 40s per job for
 * work that no longer takes that long.
 */
export const FETCH_MIN_INTERVAL_MS = MIN_INTERVAL_MS;

/** Same-host fetches a typical tournament ingest makes. */
const FETCHES_PER_INGEST = 16;
/** Median round-trip latency per fetch, on top of the politeness wait. */
const FETCH_LATENCY_MS = 300;
/** Parse + bulk DB writes, independent of the throttle. */
const PARSE_AND_WRITE_MS = 10_000;

/**
 * Wall-clock a single ingest should be expected to take at a given per-host
 * interval. The drain uses it to decide whether it has time to start
 * another job before its own deadline.
 */
export function estimateIngestMs(intervalMs: number): number {
  return FETCHES_PER_INGEST * (intervalMs + FETCH_LATENCY_MS) + PARSE_AND_WRITE_MS;
}

/**
 * Does this response mean "you are going too fast"?
 *
 * 429 and 503 are unambiguous. 403 is not: Cloudflare-fronted installs
 * answer a burst with 403 (the case this escalation exists for), but
 * Tabbycat also returns 403 for a tab a tournament has made private —
 * straight off the origin, with an ordinary HTML body. A sweep of 625 live
 * installs found 35 such 403s across participants lists and speaker/team
 * tabs, and every one of those hosts served 200s in the same pass; none
 * was throttling. Treating them as push-back moved the host to the 1.5s
 * safe interval and doubled from there, for a page that will 403 forever.
 */
export function isCdnRateLimit(status: number, headers: Headers): boolean {
  if (status === 429 || status === 503) return true;
  if (status !== 403) return false;
  return (
    headers.has('cf-ray') ||
    headers.has('cf-mitigated') ||
    /cloudflare/i.test(headers.get('server') ?? '')
  );
}

/**
 * Did the tournament itself say this page is not available? Tabbycat answers
 * "Permission Denied (403)" from the origin for a page the organisers keep
 * private (the IITM PD 2025 and HKPDS participants lists), and 404 for one
 * that does not exist. Neither will change on a retry, so neither is a fault
 * in our fetch — unlike a CDN block, a timeout or a 5xx. An absent
 * `cdnBlocked` is unknown and counts as a fault.
 */
export function isWithheldByTournament(r: { status: number; cdnBlocked?: boolean }): boolean {
  if (r.status === 404 || r.status === 410) return true;
  return r.status === 403 && r.cdnBlocked === false;
}

/** Should this response be retried? 403 only when a CDN issued it. */
export function isRetryableStatus(status: number, headers: Headers): boolean {
  if (status === 403) return isCdnRateLimit(403, headers);
  return RETRYABLE_STATUSES.has(status);
}

// HTTP statuses that deserve a retry with backoff. 404/410 are genuine
// missing; 401 means auth-required, retrying won't help; other 4xx bodies
// often carry useful error text so we surface them without a retry.
const RETRYABLE_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

/**
 * Cloudflare sometimes returns HTTP 200 for JS-challenge pages instead of
 * 403/503. Detect them so we treat the response as a fetch failure rather
 * than storing the challenge HTML as tournament data.
 */
function isCloudflareChallenge(html: string): boolean {
  return (
    html.includes('__cf_chl_') ||
    (html.includes('Just a moment') && html.includes('cloudflare'))
  );
}

/**
 * If SCRAPER_API_KEY is set, route the request through ScraperAPI which
 * rotates residential IPs and handles Cloudflare bot protection automatically.
 * When the key is absent behaviour is identical to a direct fetch.
 */
function buildTargetUrl(url: string): string {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) return url;
  return (
    `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}` +
    `&url=${encodeURIComponent(url)}&render=false&keep_headers=true`
  );
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserHeaders(referer?: string): Record<string, string> {
  const ua = process.env.TABBYCAT_USER_AGENT || DEFAULT_USER_AGENT;
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
  };
  if (referer) headers.Referer = referer;
  return headers;
}

// Raw-HTML retention cap, measured on the uncompressed page. Tabbycat tab
// pages run 100–800KB; WUDC-scale speaker tabs reach a few MB. 5MB raw
// gzips to roughly 0.5–1MB, comfortably under Postgres row/TOAST limits.
// Anything bigger is almost certainly not a tab page we'd want to re-parse.
const MAX_STORED_BODY_BYTES = 5 * 1024 * 1024;

// Per-fetch timeout. Tabbycat hosts can hang under load; without an explicit
// abort, a single slow tab fetch consumes the entire serverless function
// budget (Vercel: 60s) and burns the whole ingest. 15s is generous for a
// document fetch but well below the function ceiling, leaving room for the
// other ~16+ tab fetches to also have their chance.
const FETCH_TIMEOUT_MS = 15_000;

// Redirect hops to follow when talking to a Tabbycat host directly.
// Tabbycat itself redirects for trailing slashes and http→https, and
// Cloudflare adds its own, so a handful is normal; more than this is a
// loop or an attempt to walk us somewhere.
const MAX_REDIRECT_HOPS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function throttledFetch(url: string, session: FetchSession, referer?: string): Promise<Response> {
  const controller = new AbortController();
  // The per-request ceiling, cut short by the ingest's deadline when that
  // comes first: a request still in flight when the function is killed
  // leaves its job stuck `running` (FetchSession.deadline).
  const timeoutMs = Math.min(FETCH_TIMEOUT_MS, session.remainingMs());
  const deadlineBound = timeoutMs < FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));

  // When SCRAPER_API_KEY is set every request goes through ScraperAPI, so
  // the proxy — not this process — resolves redirects, and it is the one
  // exposed to whatever they point at. Following automatically is correct
  // there. Talking to a host directly, we must resolve each hop ourselves:
  // `redirect: 'follow'` would let a 302 from a legitimate calicotab host
  // walk the fetch onto an internal address, which is exactly the
  // allowlist bypass the entry-point validation is meant to prevent.
  const proxied = Boolean(process.env.SCRAPER_API_KEY);

  try {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      const host = new URL(current).host;
      // Serial per-host slot — see FetchSession.acquireSlot for why this
      // matters for Cloudflare-fronted Tabbycat instances. Re-acquired per
      // hop because a redirect can cross hosts.
      await session.acquireSlot(host, MIN_INTERVAL_MS);
      const cookie = session.getCookieHeader(host);

      const res = await fetch(buildTargetUrl(current), {
        headers: {
          ...browserHeaders(referer),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        redirect: proxied ? 'follow' : 'manual',
        signal: controller.signal,
      });
      session.storeCookies(host, res);

      // Learn from push-back before returning: the retry that follows, and
      // every later fetch to this host in this process, then goes out at the
      // slower rate rather than repeating the mistake.
      if (isCdnRateLimit(res.status, res.headers)) {
        session.noteRateLimited(host, MIN_INTERVAL_MS);
      }

      if (proxied || !REDIRECT_STATUSES.has(res.status)) return res;

      const location = res.headers.get('location');
      // A redirect status with no Location is malformed; hand it back and
      // let the caller treat it as the failure it is.
      if (!location) return res;

      const next = new URL(location, current);
      if (!isAllowedTabHost(next.hostname) || next.port || next.username || next.password) {
        throw new Error(
          `refusing redirect off the allowlist: ${host} → ${next.hostname}`,
        );
      }
      if (hop >= MAX_REDIRECT_HOPS) {
        throw new Error(`too many redirects (${MAX_REDIRECT_HOPS}) starting at ${url}`);
      }
      current = next.toString();
    }
  } catch (err) {
    // AbortError surfaces as a generic "aborted" message in Node 18+. Re-raise
    // with a clearer error so fetchWarnings show "fetch: tab timeout (15s)"
    // instead of a cryptic generic abort string.
    if (err instanceof Error && err.name === 'AbortError') {
      if (deadlineBound) throw new IngestDeadlineError(`ingest stopped: deadline reached while fetching ${url}`);
      throw new Error(`fetch timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry on the statuses Cloudflare uses for soft-rejections. Budget: two
 * retries at 1 s then 3 s. Per-host throttle still applies inside each call.
 */
async function fetchWithRetry(url: string, session: FetchSession, referer?: string): Promise<Response> {
  const delays = [0, 1_000, 3_000];
  let lastRes: Response | null = null;
  let lastErr: unknown = null;
  let networkRetries = 0;
  for (const delay of delays) {
    // A retry is only worth starting if it can finish before the ingest's
    // deadline. Without one, the transient failure is a reason to run the
    // whole ingest again with a full budget, not a failed attempt.
    if (delay > 0 || networkRetries > 0) session.assertTimeLeft(delay + MIN_REQUEST_MS, `retry ${url}`);
    if (delay > 0) await wait(delay);
    let res: Response;
    try {
      res = await throttledFetch(url, session, referer);
    } catch (err) {
      // A timeout or a dropped connection used to skip this loop entirely —
      // only HTTP statuses were retried — so one slow response failed the
      // whole ingest (WUDC 2022 rounds 6-9 came back "HTTP 0" though the pages
      // load fine). One retry only: a timeout costs FETCH_TIMEOUT_MS, and a
      // dead host must not eat the function's budget three times over.
      // Everything else (redirect off the allowlist, a bad URL) is a refusal
      // and rethrows at once.
      if (!isTransientNetworkError(err) || networkRetries >= 1) throw err;
      networkRetries += 1;
      lastErr = err;
      lastRes = null;
      continue;
    }
    lastErr = null;
    if (!isRetryableStatus(res.status, res.headers)) return res;
    lastRes = res;
  }
  if (lastRes) return lastRes;
  throw lastErr;
}

/** The two ways a request to a healthy host fails for no lasting reason. */
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.startsWith('fetch timeout after')) return true;
  return err instanceof TypeError && err.message === 'fetch failed';
}

export type FetchResult =
  | {
      ok: true;
      url: string;
      html: string;
      status: number;
      contentHash: string;
      contentLength: number;
      sourceDocumentId: string;
      elapsedMs: number;
    }
  | {
      ok: false;
      url: string;
      status: number;
      bodyPreview: string;
      elapsedMs: number;
      /**
       * True when a CDN (Cloudflare) refused the request, false when the
       * tournament's own server did — Tabbycat answers "Permission Denied
       * (403)" itself for a page the organisers keep private. Only the first
       * is a fault to retry; the second will answer the same forever. Absent
       * means unknown, which callers treat as a CDN.
       */
      cdnBlocked?: boolean;
    };

/**
 * Fetch an HTML page, throttled per-host, with retry on soft-fail statuses.
 * Records a SourceDocument row so every ingest has provenance and
 * parser_runs can reference the exact HTML we parsed against.
 *
 * This helper NEVER throws for HTTP errors — callers inspect the discriminated
 * `ok` field. Network-level exceptions (DNS failure, TLS error) still throw.
 */
export async function fetchHtmlWithProvenance(
  url: string,
  options: { referer?: string; session?: FetchSession } = {},
): Promise<FetchResult> {
  const start = Date.now();
  const session = options.session ?? new FetchSession();
  let res: Response;
  try {
    res = await fetchWithRetry(url, session, options.referer);
  } catch (err) {
    // Out of time is not a page failure: it ends the ingest (see
    // IngestDeadlineError) rather than becoming one "fetch:" warning.
    if (isIngestDeadlineError(err)) throw err;
    // Network failure (timeout from throttledFetch's AbortController, DNS,
    // refused connection). Convert to a soft FetchResult so a single tab
    // fetch failure doesn't reject the Promise.all in ingest.ts and crash
    // every other in-flight fetch.
    return {
      ok: false,
      url,
      status: 0,
      bodyPreview: err instanceof Error ? err.message.slice(0, 300) : 'fetch error',
      elapsedMs: Date.now() - start,
      cdnBlocked: false,
    };
  }
  const html = await res.text();
  const elapsedMs = Date.now() - start;

  if (!res.ok) {
    return {
      ok: false,
      url,
      status: res.status,
      bodyPreview: html.slice(0, 300),
      elapsedMs,
      cdnBlocked: isCdnRateLimit(res.status, res.headers),
    };
  }

  // Treat a Cloudflare JS-challenge page served with HTTP 200 as a fetch
  // failure so callers record it as a warning rather than storing challenge
  // HTML as tournament data.
  if (isCloudflareChallenge(html)) {
    return {
      ok: false,
      url,
      status: 503,
      bodyPreview: 'Cloudflare JS challenge page (requires browser execution)',
      elapsedMs,
      cdnBlocked: true,
    };
  }

  const doc = await storeSourceDocument(url, res.status, html);

  return {
    ok: true,
    url,
    html,
    status: res.status,
    contentHash: doc.contentHash,
    contentLength: doc.contentLength,
    sourceDocumentId: doc.id,
    elapsedMs,
  };
}

/**
 * Record one fetched body as a SourceDocument — the HTML tab pages and,
 * since 2026-10-25, the Tabbycat API responses that replace them.
 *
 * Retain the gzipped body alongside the hash. Historically we kept only
 * the hash, which made every new parsed field (motions, team positions)
 * require re-scraping every tournament — impossible once a Heroku tab
 * dies. Oversized bodies are skipped rather than truncated: a partial
 * body would parse as a structurally-broken page and is worse than no
 * body. The (url, contentHash) unique already dedups unchanged pages,
 * and the update branch backfills bodies onto pre-column rows when the
 * same content is re-fetched.
 */
export async function storeSourceDocument(
  url: string,
  status: number,
  body: string,
): Promise<{ id: string; contentHash: string; contentLength: number }> {
  const contentHash = sha256Hex(body);
  const contentLength = Buffer.byteLength(body, 'utf8');
  // The page body is kept in the database only when STORE_SOURCE_BODIES=1.
  // By default it is not: nothing in the app reads it back, it was 217 MB of the
  // 550 MB on 2026-10-26, and the owner keeps a local copy instead
  // (scripts/export-source-documents.mjs, docs/runbooks/source-document-bodies.md).
  // The row itself (url, hash, length, status, fetch time) is still written, so
  // the provenance trail and the unchanged-page dedup are unaffected.
  const keepBody = process.env.STORE_SOURCE_BODIES === '1' && contentLength <= MAX_STORED_BODY_BYTES;
  const bodyGzip = keepBody ? gzipSync(body) : null;

  const doc = await prisma.sourceDocument.upsert({
    where: { url_contentHash: { url, contentHash } },
    // When bodies are off, leave an existing body alone rather than null it:
    // clearing is a deliberate, separate step.
    update: keepBody
      ? { fetchedAt: new Date(), status, contentLength, bodyGzip }
      : { fetchedAt: new Date(), status, contentLength },
    create: { url, contentHash, contentLength, status, bodyGzip },
  });
  return { id: doc.id, contentHash, contentLength };
}

/**
 * Wrap the Tabbycat API fetcher so every JSON list it reads is kept as a
 * SourceDocument, keyed by the endpoint URL (owner decision B6, 2026-10-25,
 * option 1: store the JSON, newest per URL only).
 *
 * Why: once the team and speaker tabs come from the API, their HTML pages
 * are never fetched, so without this those tabs drop out of the
 * re-derivation archive — a parser change could not be replayed without
 * re-fetching, and a tournament that later withdraws its tabs would leave
 * no copy. All eight endpoints are kept, not just the standings: the
 * mappers join across them, so any one alone cannot be re-derived.
 *
 * Storage is the existing pipeline's, unchanged: gzipped body, (url, hash)
 * dedup, and pruneIngestArtifacts keeps the newest row per URL. Measured on
 * WUDC 2024, the five large endpoints (teams, speakers and the three
 * standings) gzip to ~100 KB against ~151 KB for the two HTML tabs they
 * stand in for (docs/SIZING-2026-10-25.md); the other three are small lists.
 *
 * Only a 200 whose body parses as JSON is stored: a Cloudflare challenge or
 * an install routing /api to its 404 template is not a snapshot of anything.
 * The body is stored as received, not re-serialised, so the hash is stable
 * across identical responses — except where scrubOptedOutNames had to blank
 * a name, below.
 *
 * Nothing here may change how fetchTabsFromApi classifies an answer, or cost
 * the user their ingest: a body read that fails surfaces through json(),
 * exactly where res.json() used to throw it; a failed write is logged and
 * swallowed; and the write is given SNAPSHOT_WRITE_BUDGET_MS before the
 * ingest moves on without waiting for it, so a saturated connection pool
 * cannot stall the eight sequential API reads behind it.
 */
export function withApiSnapshots(
  fetcher: (url: string) => Promise<Response>,
): (url: string) => Promise<{ status: number; json: () => Promise<unknown> }> {
  return async (url) => {
    const res = await fetcher(url);
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      return { status: res.status, json: () => Promise.reject(err) };
    }
    let parsed: { ok: true; value: unknown } | { ok: false; error: unknown };
    try {
      parsed = { ok: true, value: JSON.parse(text) };
    } catch (error) {
      parsed = { ok: false, error };
    }
    if (res.status === 200 && parsed.ok) {
      const scrubbed = scrubOptedOutNames(parsed.value);
      const body = scrubbed.changed ? JSON.stringify(scrubbed.value) : text;
      const write = storeSourceDocument(url, res.status, body).catch((err: Error) => {
        console.warn('[fetch] api snapshot not stored', { url, error: err.message });
      });
      await Promise.race([write, wait(SNAPSHOT_WRITE_BUDGET_MS)]);
    }
    return {
      status: res.status,
      json: async () => {
        if (!parsed.ok) throw parsed.error;
        return parsed.value;
      },
    };
  };
}

const SNAPSHOT_WRITE_BUDGET_MS = 2_000;

/**
 * Blank `name` / `last_name` on any object marked `anonymous: true`, at any
 * depth (the speaker list, and the speakers nested in each team).
 *
 * Tabbycat's public serialiser already nulls these for speakers who opted
 * out of the tab (WUDC 2024, 2026-10: all 10 anonymous rows came back with
 * name and last_name null). The scrub is for installs that don't: the HTML
 * tab this snapshot replaces only ever said "Redacted", and a stored body is
 * kept for good under newest-per-URL retention, so it must not hold more than
 * the public page showed. The mappers never read these fields on anonymous
 * rows (speakerDisplayName), so parsing is unaffected either way.
 */
export function scrubOptedOutNames(value: unknown): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v)) out[k] = walk(child);
    if (out.anonymous === true) {
      for (const key of ['name', 'last_name']) {
        if (out[key] != null && out[key] !== '') {
          out[key] = null;
          changed = true;
        }
      }
    }
    return out;
  };
  const result = walk(value);
  return { value: changed ? result : value, changed };
}

/** True when the HTML contains an embedded tablesData block (any known pattern). */
function hasEmbeddedTableData(html: string): boolean {
  return (
    html.includes('window.vueData') ||
    html.includes('window.tablesData') ||
    html.includes('tablesData')
  );
}

/**
 * For a given round results URL, prefer the "by-debate" variant when it
 * exists. That view lays out each debate as one row with adjudicators
 * cleanly scoped to their debate, which sidesteps the double-count
 * ambiguity we otherwise see when the "by-team" pivot mixes team and
 * adjudicator rows.
 */
export async function fetchRoundWithProvenance(
  url: string,
  options: { referer?: string; session?: FetchSession } = {},
): Promise<FetchResult> {
  const trimmed = url.replace(/\/+$/, '') + '/';
  const byDebateUrl = `${trimmed}by-debate/`;
  const byDebate = await fetchHtmlWithProvenance(byDebateUrl, options);
  // Accept the by-debate response only when it actually contains round data.
  // Tabbycat sometimes returns the generic Results overview page (200 OK) for
  // round URLs that don't exist yet — the HTML has no embedded table data.
  if (byDebate.ok && hasEmbeddedTableData(byDebate.html)) return byDebate;
  return fetchHtmlWithProvenance(trimmed, options);
}

/**
 * Single-shot probe for the admin debug endpoint. Bypasses the retry loop
 * so the operator sees the first response exactly as upstream served it.
 */
export async function probeFetch(url: string, session?: FetchSession): Promise<{
  status: number;
  ok: boolean;
  bodyPreview: string;
  elapsedMs: number;
  responseHeaders: Record<string, string>;
}> {
  const start = Date.now();
  const probeSession = session ?? new FetchSession();
  const res = await throttledFetch(url, probeSession);
  const body = await res.text();
  const elapsedMs = Date.now() - start;
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });
  return {
    status: res.status,
    ok: res.ok,
    bodyPreview: body.slice(0, 400),
    elapsedMs,
    responseHeaders,
  };
}

// Re-export for tests that assert on the outbound headers.
export const __test__ = {
  browserHeaders,
  DEFAULT_USER_AGENT,
  isCloudflareChallenge,
};
