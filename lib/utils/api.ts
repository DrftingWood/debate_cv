export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/**
 * POST JSON to an internal API route and parse the response defensively.
 * Works even when the server returns an empty body or a non-JSON body
 * (Vercel timeout HTML, Next.js default 500 page, 204 No Content).
 */
export async function postJson<T = unknown>(url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
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

  if (!res.ok) {
    const error =
      (isRecord(parsed) && typeof parsed.error === 'string' && parsed.error) ||
      (text ? text.slice(0, 200) : `HTTP ${res.status}`);
    return { ok: false, status: res.status, error };
  }

  return { ok: true, data: (parsed as T) ?? ({} as T) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
