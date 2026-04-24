import { createHash } from 'node:crypto';

export function computeFingerprint(parts: {
  host: string;
  tournamentSlug: string | null;
  tournamentName: string | null;
  year: number | null;
}): string {
  const norm = [
    parts.host.toLowerCase(),
    (parts.tournamentSlug ?? '').toLowerCase(),
    (parts.tournamentName ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
    String(parts.year ?? ''),
  ].join('|');
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

export function extractYearFromName(name: string | null): number | null {
  if (!name) return null;
  const m = name.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
