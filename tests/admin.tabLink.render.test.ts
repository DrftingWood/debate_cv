import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabLink } from '@/components/admin/TabLink';

// A long import host in a narrow column wraps between its parts, not
// mid-word (R7 final check: "calicotab.co" / "m/twin" at 1280).
describe('TabLink breakable', () => {
  it('offers a break after each dot and slash, inside one text span', () => {
    const html = renderToStaticMarkup(
      createElement(TabLink, {
        url: 'https://twinopen2024.calicotab.com/twin/',
        text: 'twinopen2024.calicotab.com/twin',
        breakable: true,
      }),
    );
    expect(html).toContain('<span>twinopen2024.<wbr/>calicotab.<wbr/>com/<wbr/>twin</span>');
    expect(html).toContain('aria-label="twinopen2024.calicotab.com/twin, opens in a new tab"');
  });

  it('leaves the text whole when not breakable', () => {
    const html = renderToStaticMarkup(
      createElement(TabLink, { url: 'https://a.calicotab.com/x/', text: 'a.calicotab.com/x' }),
    );
    expect(html).not.toContain('<wbr');
  });

  it('breaks the unlinked text too when there is no public address', () => {
    const html = renderToStaticMarkup(
      createElement(TabLink, { url: null, text: 'bare.calicotab.com', breakable: true }),
    );
    expect(html).toContain('bare.<wbr/>calicotab.<wbr/>com');
  });
});
