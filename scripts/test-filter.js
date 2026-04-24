import assert from 'node:assert/strict';
import {
  PRIVATE_URL_RE,
  extractUrlsFromText,
  parsePrivateUrl,
  extractFromMessage,
  dedupeByUrl,
} from '../src/extractor.js';

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

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

for (const u of positive) {
  PRIVATE_URL_RE.lastIndex = 0;
  assert.ok(PRIVATE_URL_RE.test(u), `should match: ${u}`);
}
for (const u of negative) {
  PRIVATE_URL_RE.lastIndex = 0;
  assert.ok(!PRIVATE_URL_RE.test(u), `should NOT match: ${u}`);
}

const found = extractUrlsFromText(
  `Hello, your private URL is https://wudc2024.calicotab.com/wudc2024/privateurls/abcd1234/. ` +
    `Another: https://ajdc.herokuapp.com/ajdc/privateurls/ZZZ999/ end.`,
);
assert.equal(found.length, 2);

const parsed = parsePrivateUrl('https://wudc2024.calicotab.com/wudc2024/privateurls/abcd1234/');
assert.equal(parsed.host, 'wudc2024.calicotab.com');
assert.equal(parsed.tournament, 'wudc2024');
assert.equal(parsed.token, 'abcd1234');

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

const extracted = extractFromMessage(msg);
assert.equal(extracted.length, 1);
assert.equal(extracted[0].token, 'TOK12345');
assert.equal(extracted[0].tournament, 'test');
assert.equal(extracted[0].subject, 'Your private URL for Test Tournament');
assert.ok(extracted[0].messageDate);

const dedup = dedupeByUrl([
  { url: 'https://a.calicotab.com/t/privateurls/X/', messageDate: '2024-02-01T00:00:00Z' },
  { url: 'https://a.calicotab.com/t/privateurls/X/', messageDate: '2024-01-01T00:00:00Z' },
]);
assert.equal(dedup.length, 1);
assert.equal(dedup[0].messageDate, '2024-01-01T00:00:00Z');

console.log('filter tests passed');
