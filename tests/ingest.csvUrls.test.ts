import { describe, expect, it } from 'vitest';
import { MAX_CSV_BYTES, MAX_CSV_URLS, parseCsvUrls } from '@/lib/ingest/csvUrls';

const url = (n: number | string) => `https://t${n}.calicotab.com/slug${n}/privateurls/tok${n}/`;

function ok(text: string) {
  const r = parseCsvUrls(text);
  if (!r.ok) throw new Error('expected a parse, got ' + r.error);
  return r;
}

describe('parseCsvUrls', () => {
  it('reads one URL per line, with or without a trailing newline and CRLF', () => {
    expect(ok(`${url(1)}\r\n${url(2)}\r\n`).urls).toEqual([url(1), url(2)]);
    expect(ok(`${url(1)}\n${url(2)}`).urls).toEqual([url(1), url(2)]);
  });

  it('uses the url column when there is a header, ignoring other columns', () => {
    const r = ok(`name,URL,notes\nWUDC,${url(1)},x\n"Pre, Open","${url(2)}",y`);
    expect(r.urls).toEqual([url(1), url(2)]);
  });

  it('strips a byte-order mark and skips blank lines', () => {
    expect(ok(`﻿${url(1)}\n\n\n${url(2)}\n`).urls).toEqual([url(1), url(2)]);
  });

  it('flags a line that is not a private tournament URL, with its line number', () => {
    const r = ok(`${url(1)}\nhttps://example.com/x\nhttp://169.254.169.254/?x=${url(2)}\n`);
    expect(r.urls).toEqual([url(1)]);
    expect(r.rows.filter((x) => x.status === 'not_a_private_url').map((x) => x.line)).toEqual([
      2, 3,
    ]);
  });

  it('flags a repeated URL once and keeps the first', () => {
    const r = ok(`${url(1)}\n${url(1)}\n`);
    expect(r.urls).toEqual([url(1)]);
    expect(r.rows.map((x) => x.status)).toEqual(['ok', 'duplicate']);
  });

  it(`takes at most ${MAX_CSV_URLS} URLs and marks the rest over the limit`, () => {
    const text = Array.from({ length: MAX_CSV_URLS + 3 }, (_, i) => url(i)).join('\n');
    const r = ok(text);
    expect(r.urls).toHaveLength(MAX_CSV_URLS);
    expect(r.rows.filter((x) => x.status === 'over_limit')).toHaveLength(3);
  });

  it('refuses an oversized or empty file', () => {
    expect(parseCsvUrls('x'.repeat(MAX_CSV_BYTES + 1))).toEqual({ ok: false, error: 'too_large' });
    expect(parseCsvUrls('  \n \r\n')).toEqual({ ok: false, error: 'empty' });
  });
});
