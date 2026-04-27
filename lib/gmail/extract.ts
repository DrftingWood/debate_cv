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

export function privateUrlVariants(rawUrl: string): string[] {
  return [...new Set([rawUrl, normalizePrivateUrl(rawUrl)])];
}

/**
 * Decode quoted-printable soft-breaks and hex escapes that Tabbycat emails
 * sometimes carry through SMTP. The most common offender is `=\n` (a soft
 * line-break injected by 7-bit-safe encoders), which splits a long URL
 * across two lines and stops the regex from matching. Hex-decoded sequences
 * like `=3D` (the `=` sign) appear when private URLs contain query strings,
 * though Tabbycat's URLs don't typically — included for robustness.
 *
 * Only run on text bodies; HTML bodies don't go through QP because Gmail
 * delivers them as base64 already.
 */
function decodeQuotedPrintable(input: string): string {
  return input
    // Soft line breaks: =<CR><LF> or =<LF>
    .replace(/=\r?\n/g, '')
    // Hex escapes: =XX where X is hex
    .replace(/=([A-F0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  // Run on both the raw text and the QP-decoded variant so URLs that span
  // a soft line break still match. Concatenate both via a separator so the
  // global regex doesn't double-count URLs that are present in both.
  const decoded = decodeQuotedPrintable(text);
  const haystack = text === decoded ? text : `${text}\n---\n${decoded}`;
  const matches = haystack.match(PRIVATE_URL_RE) || [];
  return [...new Set(matches.map(normalizePrivateUrl))];
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
