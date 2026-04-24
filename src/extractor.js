export const PRIVATE_URL_RE =
  /https?:\/\/[\w\-]+\.(?:calicotab\.com|herokuapp\.com)\/[\w\-]+\/privateurls\/[\w]+\/?/gi;

function decodeBase64Url(data) {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function stripHtml(html) {
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

function collectBodyText(payload) {
  if (!payload) return '';
  const plain = [];
  const html = [];

  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    const data = part.body && part.body.data;
    if (data) {
      const text = decodeBase64Url(data);
      if (mime.startsWith('text/plain')) plain.push(text);
      else if (mime.startsWith('text/html')) html.push(text);
      else plain.push(text);
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  };

  walk(payload);
  if (plain.length) return plain.join('\n');
  if (html.length) return stripHtml(html.join('\n'));
  return '';
}

function getHeader(headers, name) {
  if (!Array.isArray(headers)) return '';
  const h = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

export function parsePrivateUrl(rawUrl) {
  const u = new URL(rawUrl);
  const segments = u.pathname.split('/').filter(Boolean);
  const tournament = segments[0] || null;
  const token = segments[2] || null;
  return {
    url: rawUrl,
    host: u.hostname,
    tournament,
    token,
  };
}

export function extractUrlsFromText(text) {
  if (!text) return [];
  const matches = text.match(PRIVATE_URL_RE) || [];
  return matches.map((m) => m.replace(/[.,)\]\s]+$/, ''));
}

export function extractFromMessage(gmailMessage) {
  if (!gmailMessage || !gmailMessage.payload) return [];
  const headers = gmailMessage.payload.headers || [];
  const subject = getHeader(headers, 'Subject');
  const dateHeader = getHeader(headers, 'Date');
  const messageDate = gmailMessage.internalDate
    ? new Date(Number(gmailMessage.internalDate)).toISOString()
    : dateHeader || null;

  const haystack = [
    gmailMessage.snippet || '',
    subject,
    collectBodyText(gmailMessage.payload),
  ].join('\n');

  const urls = extractUrlsFromText(haystack);
  const seen = new Set();
  const out = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const parsed = parsePrivateUrl(url);
      out.push({
        ...parsed,
        messageId: gmailMessage.id,
        messageDate,
        subject,
      });
    } catch {
      // ignore malformed URLs the regex coincidentally matched
    }
  }
  return out;
}

export function dedupeByUrl(records) {
  const byUrl = new Map();
  for (const r of records) {
    const existing = byUrl.get(r.url);
    if (!existing) {
      byUrl.set(r.url, r);
      continue;
    }
    // keep the earliest sighting
    if (r.messageDate && existing.messageDate && r.messageDate < existing.messageDate) {
      byUrl.set(r.url, r);
    }
  }
  return Array.from(byUrl.values());
}
