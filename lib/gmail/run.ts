import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { extractFromMessage, dedupeByUrl, type PrivateUrlRecord } from './extract';

export const DEFAULT_QUERY =
  '(calicotab.com OR herokuapp.com OR privateurls) newer_than:5y';

const DEFAULT_MAX_MESSAGES = 500;
const CONCURRENCY = 5;

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
  options: { query?: string; max?: number } = {},
): Promise<ExtractSummary> {
  const query = options.query ?? DEFAULT_QUERY;
  const max = options.max ?? DEFAULT_MAX_MESSAGES;
  const gmail = google.gmail({ version: 'v1', auth });

  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(100, max - ids.length),
      pageToken,
    });
    (data.messages ?? []).forEach((m) => m.id && ids.push(m.id));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  const messages = await mapConcurrent<string, gmail_v1.Schema$Message>(ids, CONCURRENCY, async (id) => {
    const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
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
