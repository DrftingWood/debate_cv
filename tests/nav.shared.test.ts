import fs from 'node:fs';
import * as React from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React: typeof React }).React = React;

const authMock = vi.fn();
let pathname = '/cv';
vi.mock('@/lib/auth', () => ({ auth: authMock, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/auth/signOutAction', () => ({ signOutAction: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const { Button } = await import('@/components/ui/Button');
const { NavLink } = await import('@/components/NavLink');
const { default: AppLayout } = await import('@/app/(app)/layout');
const { PublicHeader } = await import('@/components/landing/PublicHeader');
const { pageTitle } = await import('@/lib/utils/pageTitle');

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('Button loading contract (NV-5, UX-70)', () => {
  it('stays focusable: aria-disabled and aria-busy, never the disabled attribute', () => {
    const out = html(h(Button, { loading: true }, 'Save'));
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('aria-busy="true"');
    expect(out).not.toMatch(/<button[^>]*\sdisabled(?=[\s>=])/);
    expect(out).toContain('Save');
  });

  it('keeps a genuinely disabled button disabled', () => {
    expect(html(h(Button, { disabled: true }, 'Save'))).toMatch(/<button[^>]*\sdisabled/);
  });

  it('adds no aria-disabled when idle', () => {
    expect(html(h(Button, null, 'Save'))).not.toContain('aria-disabled');
  });
});

describe('NavLink current marking (NV-3)', () => {
  const cur = (el: React.ReactElement) => html(el).includes('aria-current="page"');

  it('lights Record on /cv/motions via alsoMatch, but not Statistics', () => {
    pathname = '/cv/motions';
    expect(
      cur(
        h(
          NavLink as React.ComponentType<Record<string, unknown>>,
          { href: '/cv', exact: true, alsoMatch: ['/cv/motions'] },
          'Record',
        ),
      ),
    ).toBe(true);
    expect(
      cur(
        h(
          NavLink as React.ComponentType<Record<string, unknown>>,
          { href: '/cv/stats' },
          'Statistics',
        ),
      ),
    ).toBe(false);
  });

  it('lights Admin, not Record, on the operator tools under /cv', () => {
    pathname = '/cv/verify';
    expect(
      cur(
        h(
          NavLink as React.ComponentType<Record<string, unknown>>,
          { href: '/cv', exact: true, alsoMatch: ['/cv/motions'] },
          'Record',
        ),
      ),
    ).toBe(false);
    expect(
      cur(
        h(
          NavLink as React.ComponentType<Record<string, unknown>>,
          { href: '/admin', alsoMatch: ['/cv/tags', '/cv/verify'] },
          'Admin',
        ),
      ),
    ).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    pathname = '/dashboard-old';
    expect(
      cur(
        h(
          NavLink as React.ComponentType<Record<string, unknown>>,
          { href: '/dashboard' },
          'Imports',
        ),
      ),
    ).toBe(false);
  });

  it('adds a non-colour cue to the current item', () => {
    pathname = '/cv/stats';
    const out = html(
      h(
        NavLink as React.ComponentType<Record<string, unknown>>,
        { href: '/cv/stats' },
        'Statistics',
      ),
    );
    expect(out).toContain('font-semibold');
    expect(out).toContain('inset_0_-2px_0');
  });
});

describe('signed-out header (NV-10, NV-11)', () => {
  beforeEach(() => authMock.mockReset());

  const NAV = /<nav aria-label="Site"[\s\S]*?<\/nav>/;

  it('gives the legal-page layout the shared header: same links, sign-in, theme toggle', async () => {
    authMock.mockResolvedValue(null);
    for (const out of [
      html(h(PublicHeader)),
      html(await AppLayout({ children: h('p', null, 'x') })),
    ]) {
      const links = [...(out.match(NAV)?.[0] ?? '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(links).toEqual(['/sample', '/privacy']);
      expect(out).toContain('Sign in');
      expect(out).toContain('Switch to');
    }
  });

  it('is the header landing and sample use, and Privacy is not an in-page anchor', () => {
    for (const file of ['app/page.tsx', 'app/sample/page.tsx']) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).toContain('<PublicHeader />');
      expect(src).not.toContain('href="#privacy"');
    }
  });
});

describe('signed-in header (navigation change 2026-10-29)', () => {
  beforeEach(() => authMock.mockReset());

  const SECTIONS = /<nav aria-label="Sections"[\s\S]*?<\/nav>/;

  it('holds the four task destinations only, in order, with Settings and Admin out of it', async () => {
    process.env.ADMIN_EMAIL = 'owner@example.com';
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'owner@example.com' } });
    const out = html(await AppLayout({ children: h('p', null, 'x') }));
    const nav = out.match(SECTIONS)?.[0] ?? '';
    const links = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['/cv', '/cv/stats', '/cv/motions', '/dashboard']);
    expect(nav).not.toContain('/settings');
    expect(nav).not.toContain('/admin');
  });
});

describe('pageTitle', () => {
  it('puts the specific page first', () => {
    expect(pageTitle('Profile', 'Settings')).toBe('Profile · Settings');
    expect(pageTitle('Record')).toBe('Record');
    expect(pageTitle('Settings', 'Settings')).toBe('Settings');
  });
});
