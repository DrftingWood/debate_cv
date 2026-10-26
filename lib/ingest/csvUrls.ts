/**
 * Read a CSV of private tournament URLs a user uploads (owner decision on
 * paste-a-URL: a CSV option beside the single paste, capped at 20 URLs).
 *
 * Pure: it only decides, row by row, which lines are usable. The route runs
 * each usable URL through exactly the same path as a single paste, so a CSV
 * can never get a URL past a check a paste would fail.
 *
 * Accepted shapes: one URL per line; or a header row with a column named
 * `url` (any case) and the URL in that column; quoted fields and a UTF-8
 * byte-order mark are handled. Anything else on a line is ignored, so a
 * spreadsheet export with extra columns still works when it has a `url`
 * header.
 */

import { isPrivateUrl } from '@/lib/gmail/extract';

/** Most URLs one upload may add, the same as a single paste batch. */
export const MAX_CSV_URLS = 20;
/** A hard stop on the file itself, before any parsing. */
export const MAX_CSV_BYTES = 64 * 1024;

export type CsvRowStatus = 'ok' | 'duplicate' | 'not_a_private_url' | 'over_limit';

export type CsvRow = {
  /** 1-based line number in the file, so errors can point at it. */
  line: number;
  value: string;
  status: CsvRowStatus;
};

export type CsvParse =
  | { ok: true; rows: CsvRow[]; urls: string[] }
  | { ok: false; error: 'too_large' | 'empty' };

/** Split one CSV line into fields, honouring double quotes and doubled quotes inside them. */
function splitLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

export function parseCsvUrls(text: string): CsvParse {
  if (text.length > MAX_CSV_BYTES) return { ok: false, error: 'too_large' };
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  if (lines.every((l) => l.trim() === '')) return { ok: false, error: 'empty' };

  // A header row names the column; without one the first field is the URL.
  const firstFields = splitLine(lines.find((l) => l.trim() !== '') ?? '');
  const headerAt = firstFields.findIndex((f) => f.toLowerCase() === 'url');
  const hasHeader = headerAt !== -1;
  const column = hasHeader ? headerAt : 0;
  let headerSeen = false;

  const rows: CsvRow[] = [];
  const urls: string[] = [];
  const seen = new Set<string>();

  lines.forEach((raw, index) => {
    if (raw.trim() === '') return;
    if (hasHeader && !headerSeen) {
      headerSeen = true;
      return;
    }
    const value = splitLine(raw)[column] ?? '';
    if (value === '') return;
    const line = index + 1;
    if (!isPrivateUrl(value)) {
      rows.push({ line, value, status: 'not_a_private_url' });
    } else if (seen.has(value)) {
      rows.push({ line, value, status: 'duplicate' });
    } else if (urls.length >= MAX_CSV_URLS) {
      rows.push({ line, value, status: 'over_limit' });
    } else {
      seen.add(value);
      urls.push(value);
      rows.push({ line, value, status: 'ok' });
    }
  });

  return { ok: true, rows, urls };
}
