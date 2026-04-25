export const PRIVATE_URL_RE =
  /https?:\/\/[\w\-]+\.(?:calicotab\.com|herokuapp\.com)\/[\w\-]+\/privateurls\/[\w]+\/?/gi;

export type PrivateUrlRecord = {
  url: string;
  host: string;
  tournamentSlug: string | null;
  token: string | null;
  messageId: string;
  messageDate: string | null;
  subject: string | null;
};

type Header = { name?: string | null; value?: string | null };
type Part = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: Part[] | null;
};
type GmailMessage = {
  id?: string | null;
  internalDate?: string | null;
  snippet?: string | null;
  payload?: (Part & { headers?: Header[] | null }) | null;
};

function decodeBase64Url(data?: string | null): string {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function collectBodyText(payload: Part | null | undefined): string {
  if (!payload) return '';
  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: Part | null | undefined) => {
    if (!part) return;
    const mime = part.mimeType || '';
    const data = part.body?.data;
    if (data) {
      const text = decodeBase64Url(data);
      if (mime.startsWith('text/plain')) plain.push(text);
      else if (mime.startsWith('text/html')) html.push(text);
      else plain.push(text);
    }
    part.parts?.forEach(walk);
  };

  walk(payload);
  if (plain.length) return plain.join('\n');
  if (html.length) return stripHtml(html.join('\n'));
  return '';
}

function getHeader(headers: Header[] | null | undefined, name: string): string {
  if (!Array.isArray(headers)) return '';
  const h = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

export function parsePrivateUrl(rawUrl: string): {
  url: string;
  host: string;
  tournamentSlug: string | null;
  token: string | null;
} {
  const url = normalizePrivateUrl(rawUrl);
  const u = new URL(url);
  const segments = u.pathname.split('/').filter(Boolean);
  return {
    url,
    host: u.hostname,
    tournamentSlug: segments[0] ?? null,
    token: segments[2] ?? null,
  };
}

export function normalizePrivateUrl(rawUrl: string): string {
  return rawUrl.replace(/[.,)\]\s]+$/, '').replace(/\/+$/, '') + '/';
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(PRIVATE_URL_RE) || [];
  return matches.map(normalizePrivateUrl);
}

export function extractFromMessage(message: GmailMessage): PrivateUrlRecord[] {
  if (!message?.payload) return [];
  const headers = message.payload.headers ?? [];
  const subject = getHeader(headers, 'Subject');
  const dateHeader = getHeader(headers, 'Date');
  const messageDate = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : dateHeader || null;

  const haystack = [
    message.snippet ?? '',
    subject,
    collectBodyText(message.payload),
  ].join('\n');

  const urls = extractUrlsFromText(haystack);
  const seen = new Set<string>();
  const out: PrivateUrlRecord[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const parsed = parsePrivateUrl(url);
      out.push({
        ...parsed,
        messageId: message.id ?? '',
        messageDate,
        subject: subject || null,
      });
    } catch {
      // ignore malformed
    }
  }
  return out;
}

export function dedupeByUrl(records: PrivateUrlRecord[]): PrivateUrlRecord[] {
  const byUrl = new Map<string, PrivateUrlRecord>();
  for (const r of records) {
    const existing = byUrl.get(r.url);
    if (!existing) {
      byUrl.set(r.url, r);
      continue;
    }
    if (r.messageDate && existing.messageDate && r.messageDate < existing.messageDate) {
      byUrl.set(r.url, r);
    }
  }
  return Array.from(byUrl.values());
}
