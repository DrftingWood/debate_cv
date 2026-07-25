import { describe, expect, test } from 'vitest';
import {
  isPrivateUrl,
  isAllowedTabHost,
  PRIVATE_URL_RE,
  extractUrlsFromText,
  parsePrivateUrl,
  extractFromMessage,
  dedupeByUrl,
  normalizePrivateUrl,
  privateUrlVariants,
} from '@/lib/gmail/extract';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('PRIVATE_URL_RE', () => {
  const positive = [
    'https://wudc2024.calicotab.com/wudc2024/privateurls/a1b2c3d4/',
    'https://ajdc-2023.herokuapp.com/ajdc-2023/privateurls/ZXCVBNM0/',
    'http://sub.calicotab.com/tourney/privateurls/abc123/',
  ];
  const negative = [
    'https://wudc2024.calicotab.com/wudc2024/draw/',
    'https://random.herokuapp.com/somepath/abc/',
    'https://calicotab.com/foo/privateurls/abc/',
    'https://example.com/privateurls/abc123/',
  ];

  test.each(positive)('matches %s', (url) => {
    PRIVATE_URL_RE.lastIndex = 0;
    expect(PRIVATE_URL_RE.test(url)).toBe(true);
  });

  test.each(negative)('does not match %s', (url) => {
    PRIVATE_URL_RE.lastIndex = 0;
    expect(PRIVATE_URL_RE.test(url)).toBe(false);
  });
});

describe('extractUrlsFromText', () => {
  test('finds multiple URLs', () => {
    const urls = extractUrlsFromText(
      'Hello, your private URL is https://wudc2024.calicotab.com/wudc2024/privateurls/abcd1234/. ' +
        'Another: https://ajdc.herokuapp.com/ajdc/privateurls/ZZZ999/ end.',
    );
    expect(urls).toHaveLength(2);
  });

  test('canonicalizes matched URLs with a trailing slash', () => {
    const urls = extractUrlsFromText(
      'Link: https://test.calicotab.com/test/privateurls/TOK12345)',
    );
    expect(urls).toEqual(['https://test.calicotab.com/test/privateurls/TOK12345/']);
  });

  test('decodes quoted-printable soft line breaks that span a URL', () => {
    // SMTP encoders insert "=\n" to keep line lengths < 76 chars. Without
    // QP decoding, the URL never matches the regex.
    const text = 'Your link: https://wudc2024.calicotab.com/wudc=\n2024/privateurls/abc12345/.';
    const urls = extractUrlsFromText(text);
    expect(urls).toEqual([
      'https://wudc2024.calicotab.com/wudc2024/privateurls/abc12345/',
    ]);
  });

  test('dedupes URLs present in both raw and QP-decoded forms', () => {
    // A URL that's intact in the raw text shouldn't double-count just
    // because we ran the QP decoder over a copy.
    const text = 'Link https://x.calicotab.com/y/privateurls/TOK/.';
    const urls = extractUrlsFromText(text);
    expect(urls).toEqual(['https://x.calicotab.com/y/privateurls/TOK/']);
  });
});

describe('parsePrivateUrl', () => {
  test('returns host, slug, token', () => {
    const r = parsePrivateUrl('https://wudc2024.calicotab.com/wudc2024/privateurls/abcd1234/');
    expect(r.host).toBe('wudc2024.calicotab.com');
    expect(r.tournamentSlug).toBe('wudc2024');
    expect(r.token).toBe('abcd1234');
  });

  test('returns canonical url', () => {
    const r = parsePrivateUrl('https://wudc2024.calicotab.com/wudc2024/privateurls/abcd1234');
    expect(r.url).toBe('https://wudc2024.calicotab.com/wudc2024/privateurls/abcd1234/');
  });
});

describe('normalizePrivateUrl', () => {
  test('trims punctuation and appends one trailing slash', () => {
    expect(normalizePrivateUrl('https://x.calicotab.com/t/privateurls/abc.)')).toBe(
      'https://x.calicotab.com/t/privateurls/abc/',
    );
  });
});

describe('privateUrlVariants', () => {
  test('includes both submitted and canonical spellings', () => {
    expect(privateUrlVariants('https://x.calicotab.com/t/privateurls/abc')).toEqual([
      'https://x.calicotab.com/t/privateurls/abc',
      'https://x.calicotab.com/t/privateurls/abc/',
    ]);
  });

  test('dedupes already-canonical URLs', () => {
    expect(privateUrlVariants('https://x.calicotab.com/t/privateurls/abc/')).toEqual([
      'https://x.calicotab.com/t/privateurls/abc/',
    ]);
  });
});

describe('extractFromMessage', () => {
  test('decodes MIME parts, reads subject, and dedupes', () => {
    const plainBody =
      'Your personal link: https://test.calicotab.com/test/privateurls/TOK12345/\n' +
      'Ignore: https://test.calicotab.com/test/draw/';
    const msg = {
      id: 'm1',
      internalDate: String(Date.UTC(2024, 0, 15)),
      snippet: 'Your personal link: https://test.calicotab.com/test/privateurls/TOK12345/',
      payload: {
        headers: [
          { name: 'Subject', value: 'Your private URL for Test Tournament' },
          { name: 'Date', value: 'Mon, 15 Jan 2024 10:00:00 +0000' },
        ],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url(plainBody) } },
          {
            mimeType: 'text/html',
            body: {
              data: b64url(
                '<p>Click <a href="https://test.calicotab.com/test/privateurls/TOK12345/">here</a></p>',
              ),
            },
          },
        ],
      },
    };
    const out = extractFromMessage(msg);
    expect(out).toHaveLength(1);
    expect(out[0]!.token).toBe('TOK12345');
    expect(out[0]!.tournamentSlug).toBe('test');
    expect(out[0]!.subject).toBe('Your private URL for Test Tournament');
    expect(out[0]!.messageDate).toBeTruthy();
  });
});

describe('dedupeByUrl', () => {
  test('keeps the earliest messageDate', () => {
    const r = dedupeByUrl([
      { url: 'https://a.calicotab.com/t/privateurls/X/', host: 'a.calicotab.com', tournamentSlug: 't', token: 'X', messageId: 'a', messageDate: '2024-02-01T00:00:00Z', subject: null },
      { url: 'https://a.calicotab.com/t/privateurls/X/', host: 'a.calicotab.com', tournamentSlug: 't', token: 'X', messageId: 'b', messageDate: '2024-01-01T00:00:00Z', subject: null },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.messageDate).toBe('2024-01-01T00:00:00Z');
  });
});

describe('isPrivateUrl — the gate that decides whether the server will fetch', () => {
  test('accepts a genuine private URL on either allowed host', () => {
    expect(isPrivateUrl('https://foo.calicotab.com/mytourn/privateurls/abc123')).toBe(true);
    expect(isPrivateUrl('https://foo.calicotab.com/mytourn/privateurls/abc123/')).toBe(true);
    expect(isPrivateUrl('http://tab.herokuapp.com/slug/privateurls/tok')).toBe(true);
  });

  test('rejects a URL that merely CONTAINS a private URL (the SSRF)', () => {
    // PRIVATE_URL_RE is an unanchored scanner, so `.test()` returns true for
    // every one of these. Gating a server-side fetch on it meant an attacker
    // could name any host they liked and have it fetched.
    const smuggled = [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/?x=https://a.calicotab.com/t/privateurls/abc',
      'http://localhost:5432/?u=https://a.calicotab.com/t/privateurls/abc',
      'http://127.0.0.1/admin?next=https://a.calicotab.com/t/privateurls/abc',
      'https://attacker.example/collect?next=https://a.calicotab.com/t/privateurls/abc',
      'https://a.calicotab.com.evil.example/t/privateurls/abc',
    ];
    for (const url of smuggled) {
      PRIVATE_URL_RE.lastIndex = 0;
      expect(isPrivateUrl(url)).toBe(false);
    }
  });

  test('rejects credentials, explicit ports and non-http schemes', () => {
    expect(isPrivateUrl('https://user:pw@foo.calicotab.com/t/privateurls/abc')).toBe(false);
    expect(isPrivateUrl('https://foo.calicotab.com:8080/t/privateurls/abc')).toBe(false);
    expect(isPrivateUrl('file:///etc/passwd')).toBe(false);
    expect(isPrivateUrl('gopher://foo.calicotab.com/t/privateurls/abc')).toBe(false);
    expect(isPrivateUrl('not a url at all')).toBe(false);
  });

  test('rejects an allowed host whose path is not a private URL', () => {
    // Keeps the fetch target the shape the pipeline expects rather than an
    // arbitrary page on an allowed host.
    expect(isPrivateUrl('https://foo.calicotab.com/')).toBe(false);
    expect(isPrivateUrl('https://foo.calicotab.com/t/admin/secrets')).toBe(false);
  });
});

describe('isAllowedTabHost — per-redirect-hop check', () => {
  test('suffix match cannot be spoofed by a prefix', () => {
    expect(isAllowedTabHost('foo.calicotab.com')).toBe(true);
    expect(isAllowedTabHost('FOO.HEROKUAPP.COM')).toBe(true);
    expect(isAllowedTabHost('calicotab.com.evil.example')).toBe(false);
    expect(isAllowedTabHost('169.254.169.254')).toBe(false);
    expect(isAllowedTabHost('localhost')).toBe(false);
  });
});
