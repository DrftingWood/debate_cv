import { prisma } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';

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

const MIN_INTERVAL_MS = 750;
const lastRequestByHost = new Map<string, number>();

// HTTP statuses that deserve a retry with backoff. 404/410 are genuine
// missing; 401 means auth-required, retrying won't help; other 4xx bodies
// often carry useful error text so we surface them without a retry.
const RETRYABLE_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

// Per-host cookie jar. Module-level so clearance cookies (cf_clearance, etc.)
// persist across the multiple tab fetches that follow the landing page fetch
// within a single ingest session. Cloudflare sets these on the first request
// that passes its checks; without replaying them the subsequent tab requests
// get re-challenged and 403.
const cookieStore = new Map<string, Map<string, string>>();

function storeCookies(host: string, response: Response): void {
  // getSetCookie() is the multi-value variant available in Node 18+.
  const setCookies =
    (response.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
  if (!setCookies.length) return;
  const jar = cookieStore.get(host) ?? new Map<string, string>();
  for (const raw of setCookies) {
    const pair = raw.split(';')[0] ?? '';
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 1) continue;
    jar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
  }
  cookieStore.set(host, jar);
}

function getCookieHeader(host: string): string | undefined {
  const jar = cookieStore.get(host);
  if (!jar?.size) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

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

// Per-fetch timeout. Tabbycat hosts can hang under load; without an explicit
// abort, a single slow tab fetch consumes the entire serverless function
// budget (Vercel: 60s) and burns the whole ingest. 15s is generous for a
// document fetch but well below the function ceiling, leaving room for the
// other ~16+ tab fetches to also have their chance.
const FETCH_TIMEOUT_MS = 15_000;

async function throttledFetch(url: string, referer?: string): Promise<Response> {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - gap);
  lastRequestByHost.set(host, Date.now());

  const cookie = getCookieHeader(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(buildTargetUrl(url), {
      headers: {
        ...browserHeaders(referer),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    storeCookies(host, res);
    return res;
  } catch (err) {
    // AbortError surfaces as a generic "aborted" message in Node 18+. Re-raise
    // with a clearer error so fetchWarnings show "fetch: tab timeout (15s)"
    // instead of a cryptic generic abort string.
    if (err instanceof Error && err.name === 'AbortError') {
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
async function fetchWithRetry(url: string, referer?: string): Promise<Response> {
  const delays = [0, 1_000, 3_000];
  let lastRes: Response | null = null;
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    const res = await throttledFetch(url, referer);
    if (!RETRYABLE_STATUSES.has(res.status)) return res;
    lastRes = res;
  }
  return lastRes!;
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
  options: { referer?: string } = {},
): Promise<FetchResult> {
  const start = Date.now();
  let res: Response;
  try {
    res = await fetchWithRetry(url, options.referer);
  } catch (err) {
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
    };
  }

  const contentHash = sha256Hex(html);
  const contentLength = Buffer.byteLength(html, 'utf8');

  const doc = await prisma.sourceDocument.upsert({
    where: { url_contentHash: { url, contentHash } },
    update: { fetchedAt: new Date(), status: res.status, contentLength },
    create: { url, contentHash, contentLength, status: res.status },
  });

  return {
    ok: true,
    url,
    html,
    status: res.status,
    contentHash,
    contentLength,
    sourceDocumentId: doc.id,
    elapsedMs,
  };
}

/** Convenience wrapper that returns just the HTML string, or null on HTTP failure. */
export async function fetchHtml(url: string): Promise<string | null> {
  const r = await fetchHtmlWithProvenance(url);
  return r.ok ? r.html : null;
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
  options: { referer?: string } = {},
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
export async function probeFetch(url: string): Promise<{
  status: number;
  ok: boolean;
  bodyPreview: string;
  elapsedMs: number;
  responseHeaders: Record<string, string>;
}> {
  const start = Date.now();
  const res = await throttledFetch(url);
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
  storeCookies,
  getCookieHeader,
  isCloudflareChallenge,
  cookieStore,
};
