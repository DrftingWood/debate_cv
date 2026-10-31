import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShortUrlText } from '@/components/admin/ShortUrlText';
import { WhatIsWrong } from '@/components/admin/InboxRowParts';
import { shortenUrls } from '@/lib/admin/shortUrl';
import type { InboxRow } from '@/components/admin/InboxTable';

/**
 * Found in the R7 follow-up: a parser warning quotes the page it came from, a
 * long unbroken URL that did not wrap and painted over the Users and Age
 * columns of the Inbox. Warnings now show the path after the tournament's
 * slug; the full public address rides on the title, and the cell breaks
 * anywhere as a backstop.
 */
const LONG =
  'fetch: speaker HTTP 503 - at https://harthouse2023.calicotab.com/harthouse2023/tab/speaker/?p=6';

describe('shortenUrls', () => {
  it('keeps the path after the tournament slug', () => {
    expect(shortenUrls(LONG)).toBe('fetch: speaker HTTP 503 - at tab/speaker/?p=6');
  });
  it('leaves trailing punctuation outside the address', () => {
    expect(shortenUrls('see (https://a.calicotab.com/slug/tab/team/).')).toBe('see (tab/team/).');
  });
  it('shows host and slug for a bare tournament address, and leaves other text alone', () => {
    expect(shortenUrls('x https://a.calicotab.com/slug/ y')).toBe('x a.calicotab.com/slug y');
    expect(shortenUrls('nav: resultsRounds not found')).toBe('nav: resultsRounds not found');
  });
  it('never turns a private key into text', () => {
    expect(shortenUrls('at [private link removed]')).toBe('at [private link removed]');
  });
});

describe('ShortUrlText', () => {
  it('renders the short form, the public address in the title, and the break backstop', () => {
    const html = renderToStaticMarkup(h(ShortUrlText, { text: LONG }));
    expect(html).toContain('tab/speaker/?p=6');
    expect(html).not.toContain('>fetch: speaker HTTP 503 - at https://');
    expect(html).toContain(
      'title="fetch: speaker HTTP 503 - at https://harthouse2023.calicotab.com/harthouse2023/tab/speaker/?p=6"',
    );
    expect(html).toContain('[overflow-wrap:anywhere]');
  });
  it('scrubs a private key out of the title', () => {
    const html = renderToStaticMarkup(
      h(ShortUrlText, { text: 'at https://x.calicotab.com/s/privateurls/k3y/tab/team/' }),
    );
    expect(html).not.toContain('k3y');
  });
});

describe('the Inbox "What is wrong" cell', () => {
  it('shortens a parser summary', () => {
    const row = {
      summary: `${LONG} (1 time)`,
      more: 0,
      changed: false,
      reviewPriority: null,
    } as unknown as InboxRow;
    const html = renderToStaticMarkup(h(WhatIsWrong, { row }));
    expect(html).toContain('tab/speaker/?p=6 (1 time)');
    expect(html).toContain('[overflow-wrap:anywhere]');
  });
});
