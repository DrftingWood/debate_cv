/**
 * A failed call keeps the server's machine-readable `error` code (callers
 * branch on it, e.g. `already_claimed_by_other`) and carries two more facts
 * the routes already send, which used to be dropped here:
 *
 * - `retryAfterSec`: how long a 429 asks the caller to wait, from the body's
 *   `retryAfter` or the `Retry-After` header. Without it the dashboard could
 *   only say "Scan failed" for what is really a two-minute cooldown.
 * - `hint`: the route's own plain-language sentence (`hint` or `reason`), for
 *   codes such as `identity_mismatch` whose explanation only the server knows.
 *
 * `error` is never the raw body of a non-JSON response any more: a Vercel
 * timeout or the Next.js 500 page is HTML, and its first 200 characters used
 * to land in a toast. It is `HTTP <status>` instead. Turn any of this into
 * words for a person with `lib/ingest/userMessage.ts`; never show `error`.
 */
export type ApiFailure = {
  ok: false;
  status: number;
  error: string;
  hint?: string;
  retryAfterSec?: number;
};

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * POST JSON to an internal API route and parse the response defensively.
 * Works even when the server returns an empty body or a non-JSON body
 * (Vercel timeout HTML, Next.js default 500 page, 204 No Content).
 */
export async function postJson<T = unknown>(url: string, body?: unknown): Promise<ApiResult<T>> {
  return sendJson<T>('POST', url, body);
}

/** PATCH, with the same defensive parsing as `postJson`. */
export async function patchJson<T = unknown>(url: string, body?: unknown): Promise<ApiResult<T>> {
  return sendJson<T>('PATCH', url, body);
}

async function sendJson<T>(
  method: 'POST' | 'PATCH',
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON body; fall through */
    }
  }

  if (!res.ok) return failureFrom(res.status, parsed, res.headers.get('retry-after'));

  return { ok: true, data: (parsed as T) ?? ({} as T) };
}

/** Exported for tests: the non-OK branch of `postJson`, minus the fetch. */
export function failureFrom(
  status: number,
  parsed: unknown,
  retryAfterHeader: string | null,
): ApiFailure {
  const record = isRecord(parsed) ? parsed : {};
  const error = typeof record.error === 'string' && record.error ? record.error : `HTTP ${status}`;
  const hintSource = typeof record.hint === 'string' ? record.hint : record.reason;
  const hint = typeof hintSource === 'string' && hintSource.trim() ? hintSource : undefined;
  const retryAfterSec = positiveSeconds(record.retryAfter) ?? parseRetryAfter(retryAfterHeader);

  const failure: ApiFailure = { ok: false, status, error };
  if (hint) failure.hint = hint;
  if (retryAfterSec !== undefined) failure.retryAfterSec = retryAfterSec;
  return failure;
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3).
 * Our routes send seconds, but a proxy in front of them may not.
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return positiveSeconds(Number(trimmed));
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return positiveSeconds(Math.ceil((at - now) / 1000));
}

function positiveSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.ceil(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
