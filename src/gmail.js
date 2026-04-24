import { google } from 'googleapis';
import { extractFromMessage, dedupeByUrl } from './extractor.js';

export const DEFAULT_QUERY =
  '(calicotab.com OR herokuapp.com OR privateurls) newer_than:5y';

const DEFAULT_MAX_MESSAGES = 500;
const CONCURRENCY = 5;

async function listCandidateMessageIds(gmail, query, max) {
  const ids = [];
  let pageToken;
  while (ids.length < max) {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(100, max - ids.length),
      pageToken,
    });
    (data.messages || []).forEach((m) => ids.push(m.id));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids;
}

async function fetchMessage(gmail, id) {
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full',
  });
  return data;
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
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

export async function extractAll(auth, options = {}) {
  const query = options.query || DEFAULT_QUERY;
  const max = options.max || DEFAULT_MAX_MESSAGES;
  const gmail = google.gmail({ version: 'v1', auth });

  const ids = await listCandidateMessageIds(gmail, query, max);
  const messages = await mapConcurrent(ids, CONCURRENCY, (id) => fetchMessage(gmail, id));
  const records = messages.flatMap((m) => extractFromMessage(m));
  const deduped = dedupeByUrl(records);

  const perHost = {};
  const perTournament = {};
  for (const r of deduped) {
    perHost[r.host] = (perHost[r.host] || 0) + 1;
    if (r.tournament) perTournament[r.tournament] = (perTournament[r.tournament] || 0) + 1;
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
