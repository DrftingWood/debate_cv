import { prisma } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';

const USER_AGENT = 'debate-cv/1.0 (+https://github.com/DrftingWood/debate_cv)';
const MIN_INTERVAL_MS = 750;

const lastRequestByHost = new Map<string, number>();

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttledFetch(url: string): Promise<Response> {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - gap);
  lastRequestByHost.set(host, Date.now());
  return fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
}

export type FetchedDocument = {
  url: string;
  html: string;
  status: number;
  contentHash: string;
  contentLength: number;
  sourceDocumentId: string;
};

/**
 * Fetch an HTML page, throttled per-host. Records a SourceDocument row so
 * every ingest has provenance and parser_runs can reference the exact HTML
 * we parsed against.
 */
export async function fetchHtmlWithProvenance(url: string): Promise<FetchedDocument> {
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`fetch ${url} returned ${res.status}`);
  const html = await res.text();
  const contentHash = sha256Hex(html);
  const contentLength = Buffer.byteLength(html, 'utf8');

  const doc = await prisma.sourceDocument.upsert({
    where: { url_contentHash: { url, contentHash } },
    update: { fetchedAt: new Date(), status: res.status, contentLength },
    create: {
      url,
      contentHash,
      contentLength,
      status: res.status,
    },
  });

  return {
    url,
    html,
    status: res.status,
    contentHash,
    contentLength,
    sourceDocumentId: doc.id,
  };
}

/** Convenience wrapper that returns just the HTML string. */
export async function fetchHtml(url: string): Promise<string> {
  const doc = await fetchHtmlWithProvenance(url);
  return doc.html;
}
