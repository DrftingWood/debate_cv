/**
 * The signed-out landing page (redesign owner decision 20, design §3.1):
 * four sections, the exact trust line, and a privacy ledger whose rows are
 * facts the code backs. Rendered to static HTML with auth mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

vi.mock('@/lib/auth', () => ({ auth: async () => null, signIn: async () => {} }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/',
}));

// Async server components (the sign-in form, the header, the footer) are
// stubbed: renderToStaticMarkup cannot await them, and this suite is about
// the page's own sections.
vi.mock('@/components/landing/BuildCvButton', () => ({
  BuildCvButton: () => createElement('button', null, 'Build my debate CV'),
}));
vi.mock('@/components/landing/PublicHeader', () => ({ PublicHeader: () => null }));
vi.mock('@/components/Footer', () => ({ Footer: () => null }));

const { default: Home } = await import('@/app/page');

async function render() {
  return renderToStaticMarkup(createElement('div', null, await Home()));
}

describe('landing page', () => {
  it('has the four sections: hero, privacy ledger, how it works, closing CTA', async () => {
    const html = await render();
    expect(html).toContain('Your debate record, built from your tabs');
    expect(html).toContain('id="privacy"');
    expect(html).toContain('id="how"');
    expect(html).toContain('Start the record');
    // The retired sections are gone.
    for (const gone of [
      'Questions worth asking',
      'The questions you argue about',
      'Know the record',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('carries the trust line word for word', async () => {
    expect(await render()).toContain('Read-only Gmail · we keep tab links, never email bodies');
  });

  it('lists what we keep, including the email subject, date and the stored tab pages', async () => {
    const html = await render();
    expect(html).toContain('The subject line, date and message id of the email that held the link');
    expect(html).toContain('The tab pages as we fetched them');
    expect(html).toContain('The body of any email');
  });

  it("states the scope and Google's testing mode as they are", async () => {
    const html = await render();
    expect(html).toContain('gmail.readonly');
    expect(html).toContain('only invited test users can sign in');
  });

  it('annotates the sample with three numbered callouts, said in words', async () => {
    const html = await render();
    expect(html).toContain('Sample record · fictional');
    expect(html).toContain('Every row links to the tab it was read from.');
    expect(html).toContain('A break is marked in gold, a title the same.');
    expect(html).toContain('Placement is your team’s, not the speaker tab’s.');
  });

  it('walks through four steps', async () => {
    const html = await render();
    for (const step of ['Connect', 'Claim your name', 'Review', 'Share']) {
      expect(html).toContain(`>${step}</h3>`);
    }
  });
});
