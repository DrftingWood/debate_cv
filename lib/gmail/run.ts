import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from './client';
import { extractFromMessage, dedupeByUrl, type PrivateUrlRecord } from './extract';

export const DEFAULT_QUERY =
  '(calicotab.com OR herokuapp.com OR privateurls) newer_than:5y';

const DEFAULT_MAX_MESSAGES = 500;
const CONCURRENCY = 5;

/**
 * Wrap a Gmail API call with exponential-backoff retry on rate-limit (429)
 * responses. Honours the `Retry-After` header when Google supplies one
 * (typical for per-user quota hits) and falls back to exponential backoff
 * with full jitter when not.
 *
 * Without this, a Gmail scan on a power user (hundreds of messages, all
 * fetched concurrently) could trip the 250 quota-units-per-user-per-second
 * limit and propagate a generic "ingest_failed" to the dashboard, when the
 * fix is just to wait a second and retry.
 */
async function gmailRetryOn429<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === maxAttempts - 1;
      const status = (err as { code?: number; response?: { status?: number } })
        .response?.status ?? (err as { code?: number }).code;
      if (isLast || (status !== 429 && status !== 503)) throw err;
      // Retry-After can be seconds or HTTP-date. We only handle seconds —
      // HTTP-date is rare for API rate limits.
      const retryAfter = (err as { response?: { headers?: Record<string, string> } })
        .response?.headers?.['retry-after'];
      const headerSeconds = retryAfter ? Number(retryAfter) : NaN;
      const waitMs = Number.isFinite(headerSeconds) && headerSeconds > 0
        ? headerSeconds * 1000
        : 500 * Math.pow(2, i) + Math.floor(Math.random() * 500);
      await new Promise<void>((r) => setTimeout(r, waitMs));
    }
  }
  // Unreachable — last-attempt branch threw above.
  throw new Error('gmailRetryOn429: exhausted');
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export type ExtractSummary = {
  query: string;
  scanned: number;
  total: number;
  perHost: Record<string, number>;
  perTournament: Record<string, number>;
  urls: PrivateUrlRecord[];
};

export async function extractAllFromGmail(
  auth: OAuth2Client,
  options: { query?: string; max?: number; after?: Date } = {},
): Promise<ExtractSummary> {
  let query = options.query ?? DEFAULT_QUERY;
  // Incremental scan: caller can pass the last-known message date and we'll
  // ask Gmail to only return newer messages. Cuts a re-scan from 500 reads
  // to typically <10 once the user has done their first full scan.
  if (options.after) {
    const d = options.after;
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    query += ` after:${dateStr}`;
  }
  const max = options.max ?? DEFAULT_MAX_MESSAGES;
  const gmail = google.gmail({ version: 'v1', auth });

  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const { data } = await gmailRetryOn429(() =>
      gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(100, max - ids.length),
        pageToken,
      }),
    );
    (data.messages ?? []).forEach((m) => m.id && ids.push(m.id));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  const messages = await mapConcurrent<string, gmail_v1.Schema$Message>(ids, CONCURRENCY, async (id) => {
    const { data } = await gmailRetryOn429(() =>
      gmail.users.messages.get({ userId: 'me', id, format: 'full' }),
    );
    return data;
  });

  const records = messages.flatMap((m) => extractFromMessage(m));
  const deduped = dedupeByUrl(records);

  const perHost: Record<string, number> = {};
  const perTournament: Record<string, number> = {};
  for (const r of deduped) {
    perHost[r.host] = (perHost[r.host] ?? 0) + 1;
    if (r.tournamentSlug) perTournament[r.tournamentSlug] = (perTournament[r.tournamentSlug] ?? 0) + 1;
  }

  return {
    query,
    scanned: messages.length,
    total: deduped.length,
    perHost,
    perTournament,
    urls: deduped,
  };
}
